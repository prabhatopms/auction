import { Router } from 'express';
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { prisma } from '../prisma.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';
import { notifyVendor, sendInvoiceEmail, getLotTitle } from '../vendor/qikink.js';
import { MIN_INCREMENT } from '../constants.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder',
});

const router = Router();

/* Shape a bid for the API response */
function shapeBid(bid, myUserId) {
  return {
    id: bid.id,
    amount: bid.amount,
    createdAt: bid.createdAt,
    userId: bid.userId,
    userName: bid.user?.name ?? 'Anonymous',
    you: bid.userId === myUserId,
    hue: stringHue(bid.userId),
  };
}

/* Deterministic hue from a string */
function stringHue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % 360;
}

/* GET /api/lots/current */
router.get('/current', optionalAuth, async (req, res) => {
  // NOTE: lot closing and payment-window expiry are handled by the background
  // scheduler (cron, every minute) in scheduler.js. Do NOT run that work inline
  // here — this is a hot read endpoint hit on every page load, and doing DB
  // mutations + email sends on the request path stalls the single-process server.
  const lot = await prisma.lot.findFirst({
    where: { lotNumber: { gt: 0 } },
    orderBy: { lotNumber: 'desc' },
  });
  if (!lot) return res.status(404).json({ error: 'No active lot' });

  const [bids, totalLots] = await Promise.all([
    prisma.bid.findMany({
      where: { lotId: lot.id },
      orderBy: { amount: 'desc' },
      take: 50,
      include: { user: { select: { name: true } } },
    }),
    prisma.lot.count({ where: { lotNumber: { gt: 0 } } }),
  ]);

  const topBid = bids[0] ?? null;
  const currentBid = topBid?.amount ?? lot.startingBid;

  let myBid = null;
  let myStatus = 'none';
  if (req.userId) {
    const mine = bids.filter((b) => b.userId === req.userId);
    if (mine.length > 0) {
      myBid = mine[0].amount;
      myStatus = myBid === currentBid ? 'winning' : 'outbid';
    }
  }

  res.json({
    lot: { ...lot, totalLots },
    currentBid,
    minInc: MIN_INCREMENT,
    bidCount: bids.length,
    myBid,
    myStatus,
    bids: bids.map((b) => shapeBid(b, req.userId)),
  });
});

/* GET /api/lots/my-payment — find the lot where the authenticated user is the current payee */
router.get('/my-payment', requireAuth, async (req, res) => {
  const lot = await prisma.lot.findFirst({
    where: {
      currentPayeeId: req.userId,
      paymentStatus: { startsWith: 'pending_' },
      status: 'closed',
    },
    orderBy: { lotNumber: 'desc' },
  });
  if (!lot) return res.status(404).json({ error: 'No pending payment found.' });

  const bids = await prisma.bid.findMany({
    where: { lotId: lot.id, userId: req.userId },
    orderBy: { amount: 'desc' },
    take: 1,
  });
  const myBid = bids[0]?.amount ?? lot.startingBid;

  res.json({ lot, myBid });
});

/* POST /api/lots/create-razorpay-order */
router.post('/create-razorpay-order', requireAuth, async (req, res) => {
  try {
    const { addressId } = req.body;
    const lot = await prisma.lot.findFirst({
      where: { status: { in: ['closed', 'hidden'] }, lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'desc' },
    });
    if (!lot) return res.status(400).json({ error: 'No closed lot found.' });
    if (lot.currentPayeeId !== req.userId) return res.status(403).json({ error: 'You are not the current payee.' });
    if (lot.paymentStatus === 'paid') return res.status(400).json({ error: 'Lot is already paid.' });
    if (lot.payeeExpiresAt && new Date(lot.payeeExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'Payment window has expired.' });
    }

    const bids = await prisma.bid.findMany({ where: { lotId: lot.id, userId: req.userId }, orderBy: { amount: 'desc' }, take: 1 });
    const amount = bids[0]?.amount ?? lot.startingBid;

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `lot_${lot.id}`,
      notes: {
        lotId: lot.id,
        userId: req.userId,
        addressId: addressId ?? '',
      },
    });

    res.json({ razorpayOrderId: order.id, amount: order.amount, currency: order.currency, lotId: lot.id, lotTitle: getLotTitle(lot) });
  } catch (err) {
    console.error('[Razorpay] create order error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

/* POST /api/lots/verify-payment */
router.post('/verify-payment', requireAuth, async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, addressId, tshirtSize } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !addressId) {
    return res.status(400).json({ error: 'razorpayOrderId, razorpayPaymentId, razorpaySignature, addressId required' });
  }

  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'placeholder')
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expectedSig !== razorpaySignature) {
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  try {
    const lot = await prisma.lot.findFirst({
      where: { status: { in: ['closed', 'hidden'] }, currentPayeeId: req.userId, lotNumber: { gt: 0 } },
      orderBy: { startsAt: 'desc' },
    });
    if (!lot) return res.status(400).json({ error: 'No payable lot found for this user.' });

    // Idempotency: webhook may have already created the order
    const existingOrder = await prisma.order.findUnique({ where: { lotId: lot.id } });
    if (existingOrder) {
      return res.json({ ok: true, orderId: existingOrder.id, orderNumber: existingOrder.orderNumber });
    }

    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== req.userId) return res.status(400).json({ error: 'Invalid address.' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const bids = await prisma.bid.findMany({ where: { lotId: lot.id, userId: req.userId }, orderBy: { amount: 'desc' }, take: 1 });
    const amount = bids[0]?.amount ?? lot.startingBid;

    const year = new Date().getFullYear();
    const orderCount = await prisma.order.count();
    const orderNumber = `OX-${year}-${String(orderCount + 1).padStart(3, '0')}`;

    const [, order] = await prisma.$transaction([
      prisma.lot.update({
        where: { id: lot.id },
        data: { paymentStatus: 'paid', winnerId: req.userId, soldPrice: amount },
      }),
      prisma.order.create({
        data: {
          orderNumber,
          lotId: lot.id,
          userId: req.userId,
          addressId,
          amount: amount * 100,
          tshirtSize: tshirtSize || 'M',
          razorpayOrderId,
          razorpayPaymentId,
          status: 'processing',
        },
      }),
    ]);

    getIo()?.emit('lot:paid', { lotId: lot.id, winnerId: req.userId });

    notifyVendor(order, lot, address, user.email).catch((e) => console.error('[Vendor] notify failed:', e));
    sendInvoiceEmail(order, lot, address, user.email, user.name).catch((e) => console.error('[Invoice] email failed:', e));

    res.json({ ok: true, orderId: order.id, orderNumber });
  } catch (err) {
    // P2002 = unique constraint: webhook beat us to creating the order — return it as success
    if (err.code === 'P2002') {
      try {
        const o = await prisma.order.findFirst({ where: { razorpayOrderId } });
        if (o) return res.json({ ok: true, orderId: o.id, orderNumber: o.orderNumber });
      } catch { /* fall through */ }
    }
    console.error('[Payment] verify error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

/* GET /api/lots/past */
router.get('/past', async (req, res) => {
  const lots = await prisma.lot.findMany({
    where: { status: 'closed', lotNumber: { gt: 0 } },
    orderBy: { endsAt: 'desc' },
    take: 50,
    include: {
      _count: {
        select: { bids: true },
      },
      bids: {
        orderBy: { amount: 'desc' },
        take: 1,
        include: { user: { select: { name: true } } },
      },
      order: {
        select: { amount: true, user: { select: { name: true } } },
      },
      artworkDrafts: {
        select: { id: true, artworkUrl: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  res.json({ lots });
});

/* GET /api/lots/:id */
router.get('/:id', optionalAuth, async (req, res) => {
  let isAdmin = false;
  if (req.userId) {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
    const ADMIN_EMAILS = ['harshit.rnnh@gmail.com', 'prabhat1992@gmail.com', 'abmzone@gmail.com'];
    if (user && ADMIN_EMAILS.includes(user.email)) {
      isAdmin = true;
    }
  }

  const lot = await prisma.lot.findUnique({ where: { id: req.params.id } });
  if (!lot || (lot.lotNumber < 0 && !isAdmin)) return res.status(404).json({ error: 'Lot not found' });

  const bids = await prisma.bid.findMany({
    where: { lotId: lot.id },
    orderBy: { amount: 'desc' },
    include: { user: { select: { name: true } } },
  });

  const currentBid = bids[0]?.amount ?? lot.startingBid;
  res.json({
    lot,
    currentBid,
    bidCount: bids.length,
    bids: bids.map((b) => shapeBid(b, req.userId)),
  });
});

/* POST /api/lots/dev-simulate-payment — only works when Razorpay is not configured */
router.post('/dev-simulate-payment', requireAuth, async (req, res) => {
  if (process.env.RAZORPAY_KEY_ID) {
    return res.status(400).json({ error: 'Simulation not available — Razorpay is configured' });
  }
  const { addressId, tshirtSize } = req.body;
  if (!addressId) return res.status(400).json({ error: 'addressId required' });
  if (!tshirtSize) return res.status(400).json({ error: 'tshirtSize required' });

  try {
    const lot = await prisma.lot.findFirst({
      where: { status: { in: ['closed', 'hidden'] }, currentPayeeId: req.userId, lotNumber: { gt: 0 } },
      orderBy: { startsAt: 'desc' },
    });
    if (!lot) return res.status(400).json({ error: 'No payable lot found for this user.' });

    if (lot.payeeExpiresAt && new Date(lot.payeeExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'Payment window has expired.' });
    }

    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== req.userId) return res.status(400).json({ error: 'Invalid address.' });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const bids = await prisma.bid.findMany({
      where: { lotId: lot.id, userId: req.userId },
      orderBy: { amount: 'desc' },
      take: 1,
    });
    const amount = bids[0]?.amount ?? lot.startingBid;

    const year = new Date().getFullYear();
    const orderCount = await prisma.order.count();
    const orderNumber = `OX-${year}-${String(orderCount + 1).padStart(3, '0')}`;

    const [, order] = await prisma.$transaction([
      prisma.lot.update({
        where: { id: lot.id },
        data: { paymentStatus: 'paid', winnerId: req.userId, soldPrice: amount },
      }),
      prisma.order.create({
        data: {
          orderNumber,
          lotId: lot.id,
          userId: req.userId,
          addressId,
          amount: amount * 100,
          tshirtSize,
          razorpayOrderId: `sim_${Date.now()}`,
          razorpayPaymentId: `sim_pay_${Date.now()}`,
          status: 'processing',
        },
      }),
    ]);

    getIo()?.emit('lot:paid', { lotId: lot.id, winnerId: req.userId });
    notifyVendor(order, lot, address, user.email).catch((e) => console.error('[Vendor] notify failed:', e));
    sendInvoiceEmail(order, lot, address, user.email, user.name).catch((e) => console.error('[Invoice] email failed:', e));

    res.json({ ok: true, orderId: order.id, orderNumber });
  } catch (err) {
    console.error('[SimPayment] error:', err);
    res.status(500).json({ error: 'Simulation failed' });
  }
});

export default router;
