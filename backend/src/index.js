import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setIo, getIo } from './socket.js';
import { prisma } from './prisma.js';
import { requireAdmin } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import lotRoutes from './routes/lots.js';
import bidRoutes from './routes/bids.js';
import addressRoutes from './routes/addresses.js';
import orderRoutes from './routes/orders.js';
import vendorRoutes from './routes/vendor.js';
import ogRoutes from './routes/og.js';
import { startScheduler, closeActiveLot, checkPaymentExpirations, createNewLot } from './scheduler.js';
import { generateDailyArtwork, collectDailyData, generatePromptFromSignals, generateImageFromPrompt } from './artGenerator.js';
import { notifyVendor, sendInvoiceEmail, sendShippingEmail } from './vendor/qikink.js';
import { postLotToInstagram } from './instagramMarketing.js';

// Load .env from backend directory
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const lines = readFileSync(join(__dir, '../.env'), 'utf8').split('\n');
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^['"](.*)['"]$/, '$1');
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* env file optional */ }

// Load GCP service account credentials from env variable if present
if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
  try {
    const keyPath = join(tmpdir(), 'gcp-key.json');
    const parsed = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
    writeFileSync(keyPath, JSON.stringify(parsed), 'utf8');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
    console.log('[Oxide] Dynamically loaded GCP credentials key to:', keyPath);
  } catch (err) {
    console.error('[Oxide] Failed to parse/write GCP_SERVICE_ACCOUNT_JSON:', err.message);
  }
}

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'http://localhost:5190',
  'https://oxide.chemicalfarmers.com',
  'https://oxide.chemicalfarmers.in',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Allow non-CORS requests (like curl)
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === 'chemicalfarmers.com' || url.hostname.endsWith('.chemicalfarmers.com') ||
        url.hostname === 'chemicalfarmers.in' || url.hostname.endsWith('.chemicalfarmers.in')) {
      return true;
    }
  } catch { /* invalid URL */ }
  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
};

const io = new Server(httpServer, {
  cors: corsOptions,
});
setIo(io);

app.use(cors(corsOptions));

/* Razorpay webhook — must use raw body for HMAC verification, registered before express.json() */
app.post('/api/razorpay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (secret) {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');
    if (expectedSig !== sig) {
      console.warn('[Webhook] Invalid signature — rejecting');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  } else {
    console.warn('[Webhook] RAZORPAY_WEBHOOK_SECRET not set — skipping signature check');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (payload.event !== 'payment.captured') {
    return res.status(200).json({ ok: true });
  }

  const payment = payload.payload?.payment?.entity;
  if (!payment) return res.status(200).json({ ok: true });

  const razorpayOrderId = payment.order_id;
  const razorpayPaymentId = payment.id;
  const { lotId, userId, addressId } = payment.notes ?? {};

  try {
    const existing = await prisma.order.findFirst({ where: { razorpayOrderId } });
    if (existing) {
      console.log(`[Webhook] payment.captured already processed for order ${razorpayOrderId}`);
      return res.status(200).json({ ok: true, duplicate: true });
    }

    if (!lotId || !userId || !addressId) {
      console.error('[Webhook] Missing notes on payment', razorpayPaymentId);
      return res.status(200).json({ ok: true });
    }

    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot || lot.paymentStatus === 'paid') {
      return res.status(200).json({ ok: true });
    }

    const [address, user, bids] = await Promise.all([
      prisma.address.findUnique({ where: { id: addressId } }),
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.bid.findMany({ where: { lotId, userId }, orderBy: { amount: 'desc' }, take: 1 }),
    ]);

    const amount = bids[0]?.amount ?? lot.startingBid;
    const year = new Date().getFullYear();
    const orderCount = await prisma.order.count();
    const orderNumber = `OX-${year}-${String(orderCount + 1).padStart(3, '0')}`;

    const [, order] = await prisma.$transaction([
      prisma.lot.update({
        where: { id: lotId },
        data: { paymentStatus: 'paid', winnerId: userId, soldPrice: amount },
      }),
      prisma.order.create({
        data: {
          orderNumber,
          lotId,
          userId,
          addressId,
          amount: amount * 100,
          razorpayOrderId,
          razorpayPaymentId,
          status: 'processing',
        },
      }),
    ]);

    getIo()?.emit('lot:paid', { lotId, winnerId: userId });
    notifyVendor(order, lot, address).catch((e) => console.error('[Webhook] vendor notify failed:', e));
    sendInvoiceEmail(order, lot, address, user.email, user.name).catch((e) => console.error('[Webhook] invoice email failed:', e));

    console.log(`[Webhook] payment.captured — created order ${orderNumber}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Webhook] Error processing payment:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.use(express.json());
app.use('/public', express.static(join(__dir, '../public')));

app.use('/api/admin', requireAdmin);

app.use('/api/auth', authRoutes);
app.use('/api/lots', lotRoutes);
app.use('/api/lots', bidRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/og', cors({ origin: '*' }), ogRoutes);

app.post('/api/admin/rotate', async (_req, res) => {
  await closeActiveLot();
  res.json({ ok: true });
});

app.post('/api/admin/close-bid', async (_req, res) => {
  try {
    await closeActiveLot();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] close-bid error:', err);
    res.status(500).json({ error: 'Failed to close bid' });
  }
});

const GCS_BUCKET = process.env.GCS_BUCKET_NAME;
function isAllowedArtworkUrl(url) {
  if (!url) return true;
  if (url.startsWith('/public/artwork/')) return true;
  if (GCS_BUCKET && url.startsWith(`https://storage.googleapis.com/${GCS_BUCKET}/`)) return true;
  return false;
}

// Generate artwork, save as a draft
app.post('/api/admin/generate-artwork-draft', requireAdmin, async (_req, res) => {
  try {
    const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });
    const draftNum = `draft-${Date.now()}`;
    const art = await generateDailyArtwork(draftNum);
    const draft = await prisma.artworkDraft.create({
      data: {
        lotId: activeLot?.id ?? null,
        artworkUrl: art.artworkUrl,
        artworkHeadline: art.artworkHeadline,
        artworkPrompt: art.artworkPrompt,
      },
    });
    res.json({ ok: true, draft });
  } catch (err) {
    console.error('[Admin] generate-artwork-draft error:', err);
    res.status(500).json({ error: err.message || 'Artwork generation failed' });
  }
});

app.get('/api/admin/daily-signals', requireAdmin, async (_req, res) => {
  try {
    const today = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateString = formatter.format(today);
    const data = await collectDailyData(dateString);
    res.json({ ok: true, data: data.data_signals_of_the_day });
  } catch (err) {
    console.error('[Admin] daily-signals error:', err);
    res.status(500).json({ error: err.message || 'Failed to collect daily signals' });
  }
});

app.post('/api/admin/generate-prompt', requireAdmin, async (req, res) => {
  try {
    const { selectedSignals } = req.body;
    if (!selectedSignals || !Array.isArray(selectedSignals)) {
      return res.status(400).json({ error: 'selectedSignals array is required' });
    }
    const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });
    const lotNumber = activeLot ? activeLot.lotNumber : 1;
    const result = await generatePromptFromSignals(selectedSignals, lotNumber);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[Admin] generate-prompt error:', err);
    res.status(500).json({ error: err.message || 'Prompt generation failed' });
  }
});

app.post('/api/admin/generate-image-from-prompt', requireAdmin, async (req, res) => {
  try {
    const { prompt, title, essence, interpretive_statement, data_signals_used, data_signals_used_summarized } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });

    const draftNum = `draft-${Date.now()}`;
    const lotHeadlineStr = JSON.stringify({
      title: title || 'Untitled',
      data_signals_used: data_signals_used || [],
      data_signals_used_summarized: data_signals_used_summarized || [],
      essence: essence || '',
      interpretive_statement: interpretive_statement || ''
    });

    const art = await generateImageFromPrompt(prompt, draftNum, lotHeadlineStr);
    const draft = await prisma.artworkDraft.create({
      data: {
        lotId: activeLot ? activeLot.id : null,
        artworkUrl: art.artworkUrl,
        artworkHeadline: art.artworkHeadline,
        artworkPrompt: art.artworkPrompt,
      },
    });
    res.json({ ok: true, draft });
  } catch (err) {
    console.error('[Admin] generate-image-from-prompt error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

// Return all drafts for a given lot
app.get('/api/admin/artwork-drafts', requireAdmin, async (req, res) => {
  try {
    const { lotId, includeUnassigned } = req.query;
    
    let whereClause = { lotId: null };
    if (lotId) {
      whereClause = includeUnassigned === 'true' 
        ? { OR: [{ lotId }, { lotId: null }] } 
        : { lotId };
    }

    const drafts = await prisma.artworkDraft.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ drafts });
  } catch (err) {
    console.error('[Admin] artwork-drafts error:', err);
    res.status(500).json({ error: 'Failed to fetch drafts' });
  }
});

// Return past lots (closed or hidden, newest first) with their draft count — for the session repository
app.get('/api/admin/session-history', requireAdmin, async (_req, res) => {
  try {
    const lots = await prisma.lot.findMany({
      where: { status: { in: ['closed', 'hidden'] } },
      orderBy: { lotNumber: 'desc' },
      select: {
        id: true, lotNumber: true, title: true, artworkUrl: true, artworkHeadline: true,
        startsAt: true, endsAt: true, status: true,
        _count: { select: { artworkDrafts: true } },
      },
    });
    res.json({ lots });
  } catch (err) {
    console.error('[Admin] session-history error:', err);
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});

// Toggle lot visibility (switch status between closed and hidden)
app.post('/api/admin/toggle-lot-visibility', requireAdmin, async (req, res) => {
  try {
    const { lotId } = req.body;
    if (!lotId) return res.status(400).json({ error: 'lotId is required' });

    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    if (lot.status !== 'closed' && lot.status !== 'hidden') {
      return res.status(400).json({ error: 'Only closed or hidden lots can have their visibility toggled.' });
    }

    const newStatus = lot.status === 'closed' ? 'hidden' : 'closed';
    const updatedLot = await prisma.lot.update({
      where: { id: lotId },
      data: { status: newStatus },
    });

    res.json({ ok: true, status: updatedLot.status });
  } catch (err) {
    console.error('[Admin] toggle-lot-visibility error:', err);
    res.status(500).json({ error: 'Failed to toggle lot visibility' });
  }
});

// Promote a draft to be the active artwork on a lot
app.post('/api/admin/set-artwork', requireAdmin, async (req, res) => {
  try {
    const { draftId, lotId } = req.body;
    let draft;
    if (draftId.startsWith('synth-')) {
      const sourceLotId = draftId.substring(6);
      const sourceLot = await prisma.lot.findUnique({ where: { id: sourceLotId } });
      if (!sourceLot) return res.status(404).json({ error: 'Source lot not found' });
      draft = {
        artworkUrl: sourceLot.artworkUrl,
        artworkHeadline: sourceLot.artworkHeadline,
        artworkPrompt: sourceLot.artworkPrompt,
      };
    } else {
      draft = await prisma.artworkDraft.findUnique({ where: { id: draftId } });
      if (!draft) return res.status(404).json({ error: 'Draft not found' });
    }

    const targetLot = lotId
      ? await prisma.lot.findUnique({ where: { id: lotId } })
      : await prisma.lot.findFirst({ where: { status: 'active' } });
    if (!targetLot) return res.status(404).json({ error: 'No target lot found' });

    if (!isAllowedArtworkUrl(draft.artworkUrl)) {
      return res.status(400).json({ error: 'Invalid artwork URL in draft' });
    }

    const updated = await prisma.lot.update({
      where: { id: targetLot.id },
      data: {
        artworkUrl: draft.artworkUrl,
        artworkHeadline: draft.artworkHeadline,
        artworkPrompt: draft.artworkPrompt,
      },
    });

    if (!draftId.startsWith('synth-')) {
      // Link the draft to the target lot so it is saved and visible under this lot
      await prisma.artworkDraft.update({
        where: { id: draftId },
        data: { lotId: targetLot.id },
      });
    }

    getIo()?.emit('lot:artwork_updated', {
      lotId: updated.id,
      artworkUrl: updated.artworkUrl,
      artworkHeadline: updated.artworkHeadline,
      artworkPrompt: updated.artworkPrompt,
      swappedAt: Date.now(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] set-artwork error:', err);
    res.status(500).json({ error: 'Failed to set artwork' });
  }
});

app.post('/api/admin/new-bid', requireAdmin, async (req, res) => {
  try {
    const { draftId } = req.body ?? {};
    let artwork = null;
    if (draftId) {
      if (draftId.startsWith('synth-')) {
        const sourceLotId = draftId.substring(6);
        const sourceLot = await prisma.lot.findUnique({ where: { id: sourceLotId } });
        if (!sourceLot) return res.status(404).json({ error: 'Source lot not found' });
        artwork = { artworkUrl: sourceLot.artworkUrl, artworkHeadline: sourceLot.artworkHeadline, artworkPrompt: sourceLot.artworkPrompt };
      } else {
        const draft = await prisma.artworkDraft.findUnique({ where: { id: draftId } });
        if (!draft) return res.status(404).json({ error: 'Draft not found' });
        if (!isAllowedArtworkUrl(draft.artworkUrl)) return res.status(400).json({ error: 'Invalid artwork URL' });
        artwork = { artworkUrl: draft.artworkUrl, artworkHeadline: draft.artworkHeadline, artworkPrompt: draft.artworkPrompt };
      }
    }
    // Close the active lot first so the highest bidder is set as winner
    const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });
    if (activeLot) {
      await closeActiveLot();
    }
    // Use the global max lot number (not just closed lots) to avoid unique-constraint errors
    const latestLot = await prisma.lot.findFirst({
      where: { lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'desc' },
    });
    const nextNum = latestLot ? latestLot.lotNumber + 1 : 1;
    const createdLot = await createNewLot(nextNum, artwork);
    if (draftId && !draftId.startsWith('synth-') && createdLot) {
      await prisma.artworkDraft.update({
        where: { id: draftId },
        data: { lotId: createdLot.id }
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] new-bid error:', err);
    res.status(500).json({ error: 'Failed to create new bid' });
  }
});

app.get('/api/admin/orders', async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        lot: { select: { title: true, lotNumber: true, artworkUrl: true, size: true, artist: true, artworkHeadline: true } },
        user: { select: { name: true, email: true, phone: true } },
        address: true,
      },
    });
    res.json({ orders });
  } catch (err) {
    console.error('[Admin] orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/admin/reset', async (req, res) => {
  const { password } = req.body;
  if (password !== 'cron1212') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[Admin Reset] Initiating auction reset...');
    // 1. Close current active lot if there is one
    await closeActiveLot();

    // 2. Determine next lot number
    const latestClosed = await prisma.lot.findFirst({
      where: { status: { in: ['closed', 'hidden'] } },
      orderBy: { lotNumber: 'desc' },
    });
    const nextNum = latestClosed ? latestClosed.lotNumber + 1 : 1;

    // 3. Create new lot
    await createNewLot(nextNum);

    console.log('[Admin Reset] Auction reset complete. Created lot:', nextNum);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin Reset] Reset failed:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Soft Reset: re-number existing positive lot numbers to negative lot numbers to start fresh from Lot #1
app.post('/api/admin/reset-db-to-lot-1', requireAdmin, async (_req, res) => {
  try {
    console.log('[Admin Reset] Initiating soft sequence reset to start from Lot #1...');
    
    // Close current active lot if there is one
    await closeActiveLot();

    // Find the minimum lotNumber currently in the database to avoid unique constraint collisions
    const minLotResult = await prisma.lot.aggregate({
      _min: { lotNumber: true }
    });
    let currentMin = minLotResult._min.lotNumber || 0;
    if (currentMin > 0) currentMin = 0;

    // Find all lots that have a positive lotNumber
    const lotsToUpdate = await prisma.lot.findMany({
      where: { lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'asc' },
    });

    // Renumber existing lots to unique negative numbers
    for (const lot of lotsToUpdate) {
      currentMin--;
      await prisma.lot.update({
        where: { id: lot.id },
        data: { lotNumber: currentMin },
      });
    }

    // Create Lot #1 (fresh active rotation with empty artwork)
    await createNewLot(1, { artworkUrl: null, artworkHeadline: null, artworkPrompt: null });

    console.log('[Admin Reset] Database sequence reset successfully. Lot #1 is now live.');
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin Reset] Failed:', err);
    res.status(500).json({ error: 'Failed to reset database sequence: ' + err.message });
  }
});

app.post('/api/admin/check-expirations', async (_req, res) => {
  await checkPaymentExpirations();
  res.json({ ok: true });
});

app.put('/api/admin/orders/:id/tracking', async (req, res) => {
  const { status, carrier, trackingNumber, trackingUrl, notes } = req.body;
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const now = new Date();
  const update = {};
  if (status) update.status = status;
  if (carrier !== undefined) update.carrier = carrier;
  if (trackingNumber !== undefined) update.trackingNumber = trackingNumber;
  if (trackingUrl !== undefined) update.trackingUrl = trackingUrl;
  if (notes !== undefined) update.notes = notes;
  if (status === 'printing' && !order.printedAt) update.printedAt = now;
  if (status === 'shipped' && !order.shippedAt) update.shippedAt = now;
  if (status === 'delivered' && !order.deliveredAt) update.deliveredAt = now;

  const updated = await prisma.order.update({ where: { id: req.params.id }, data: update });
  getIo()?.to(`user:${order.userId}`).emit('order:updated', { orderId: order.id, status: updated.status });

  if (status === 'shipped' && !order.shippedAt) {
    try {
      const [lot, address, user] = await Promise.all([
        prisma.lot.findUnique({ where: { id: order.lotId } }),
        prisma.address.findUnique({ where: { id: order.addressId } }),
        prisma.user.findUnique({ where: { id: order.userId } }),
      ]);
      sendShippingEmail(updated, lot, address, user.email, user.name).catch((e) =>
        console.error('[Shipping email] failed:', e)
      );
    } catch (e) {
      console.error('[Shipping email] lookup failed:', e);
    }
  }

  res.json({ ok: true, order: updated });
});

app.post('/api/admin/orders/:id/resend-invoice', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { lot: true, address: true, user: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await sendInvoiceEmail(order, order.lot, order.address, order.user.email, order.user.name);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Resend invoice] error:', err);
    res.status(500).json({ error: 'Failed to resend invoice' });
  }
});

app.post('/api/admin/orders/:id/resend-vendor', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { lot: true, address: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await notifyVendor(order, order.lot, order.address);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Resend vendor] error:', err);
    res.status(500).json({ error: 'Failed to resend vendor notification' });
  }
});

// Manually trigger an Instagram post for a specific draft, lot, or the active lot
app.post('/api/admin/instagram/post-now', requireAdmin, async (req, res) => {
  try {
    const { lotId, draftId } = req.body;

    let postTarget;
    if (draftId) {
      const draft = await prisma.artworkDraft.findUnique({
        where: { id: draftId },
        include: { lot: true },
      });
      if (!draft) return res.status(404).json({ error: 'Draft not found' });
      // Resolve artwork URL: draft → lot → constructed GCS path (DB can lag behind GCS)
      const lotNumber = draft.lot?.lotNumber;
      const resolvedUrl = draft.artworkUrl
        ?? draft.lot?.artworkUrl
        ?? (lotNumber && process.env.GCS_BUCKET_NAME
            ? `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/artwork/lot-${lotNumber}.png`
            : null);
      postTarget = {
        lotNumber: lotNumber ?? 0,
        startingBid: draft.lot?.startingBid ?? 0,
        artworkUrl: resolvedUrl,
        artworkHeadline: draft.artworkHeadline ?? draft.lot?.artworkHeadline,
      };
    } else {
      postTarget = lotId
        ? await prisma.lot.findUnique({ where: { id: lotId } })
        : await prisma.lot.findFirst({ where: { status: 'active' }, orderBy: { lotNumber: 'desc' } });
      if (!postTarget) return res.status(404).json({ error: 'No lot found' });
    }

    const postId = await postLotToInstagram(postTarget);
    if (!postId) return res.status(500).json({ error: 'Instagram post failed — check server logs' });
    res.json({ ok: true, postId });
  } catch (err) {
    console.error('[Admin] Instagram post-now error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* Artwork proxy — serves locally cached file OR fetches from GCS on-demand.
   Solves the CORS problem: frontend fetches from this backend, not GCS directly. */
app.get('/api/artwork/:filename', async (req, res) => {
  const { filename } = req.params;
  if (!/^lot-[\w-]+\.png$/.test(filename)) return res.status(400).json({ error: 'Invalid filename' });

  const localPath = join(__dir, '../public/artwork', filename);

  // 1. Try local cache first (fast, works in dev)
  try {
    const { createReadStream } = await import('node:fs');
    const { stat } = await import('node:fs/promises');
    await stat(localPath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    createReadStream(localPath).pipe(res);
    return;
  } catch { /* not cached locally, fall through to GCS */ }

  const lotNumber = filename.match(/\d+/)[0];

  // 2. Fetch from GCS using storage SDK and stream back
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (bucketName) {
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(`artwork/${filename}`);

      const [exists] = await file.exists();
      if (exists) {
        const [buffer] = await file.download();

        // Save to local cache directory for future requests
        const { writeFile } = await import('node:fs/promises');
        try {
          await writeFile(localPath, buffer);
        } catch (e) {
          console.error('[Artwork Proxy] Failed to cache GCS file locally:', e.message);
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(buffer);
        return;
      }
    } catch (gcsErr) {
      console.error('[Artwork Proxy] GCS download failed:', gcsErr.message);
    }
  }

  // 3. Fallback: Fetch a beautiful placeholder based on the lot number, cache it locally, and serve
  try {
    console.log(`[Artwork Proxy] Artwork ${filename} not found in GCS/local. Fetching fallback placeholder...`);
    const fallbackUrl = `https://picsum.photos/seed/${lotNumber}/800/800`;
    const r = await fetch(fallbackUrl);
    if (!r.ok) throw new Error('Picsum fetch failed');

    const buffer = Buffer.from(await r.arrayBuffer());

    // Save to local cache directory
    const { writeFile } = await import('node:fs/promises');
    await writeFile(localPath, buffer);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (fallbackErr) {
    console.error('[Artwork Proxy] Fallback generation failed:', fallbackErr.message);
    res.status(404).json({ error: 'Artwork not found' });
  }
});


io.on('connection', (socket) => {
  socket.on('join:lot', (lotId) => socket.join(`lot:${lotId}`));
  socket.on('join:user', (userId) => socket.join(`user:${userId}`));
});

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, async () => {
  console.log(`[Oxide] API  →  http://localhost:${PORT}`);
  await startScheduler();
});
// Server reload trigger

