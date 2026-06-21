import cron from 'node-cron';
import { Resend } from 'resend';
import { prisma } from './prisma.js';
import { getIo } from './socket.js';
import { generateDailyArtwork } from './artGenerator.js';
import { STARTING_BID } from './constants.js';
import { getLotTitle, lotNo, lotDateStr, getAppUrl, productImageBlock, ctaButton, emailWrapper, escHtml } from './email-helpers.js';
import { pollQikinkOrders } from './vendor/qikink.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const BIDDING_DURATION_MS = 18 * 60 * 60 * 1000; // 18 hours
const AUTO_RESTART_DELAY_MS = 6 * 60 * 60 * 1000; // 6 hours between close and next open

const LOT_TEMPLATES = [
  {
    title: 'Untitled (Drift No. 7)',
    artist: 'Oxide Atelier',
    description:
      'A one-off wearable artwork — a latent-space bloom, screen-printed in seven passes. Includes a signed provenance token.',
  },
  {
    title: 'Nebula Fade No. 12',
    artist: 'Oxide Atelier',
    description:
      'Deep-field generative print — a cascade of spectral gradients frozen in organic heavyweight cotton.',
  },
  {
    title: 'Stardust Overprint No. 3',
    artist: 'Oxide Atelier',
    description:
      'Seven-layer screen print. AI-generated aurora patterns rendered in photoluminescent ink on natural cotton.',
  },
  {
    title: 'Latent Space No. 19',
    artist: 'Oxide Atelier',
    description:
      'A collision of high-dimensional data mapped to pigment. Each warp and weft carries a unique seed. Signed on the inner tag.',
  },
  {
    title: 'Chromatic Fold No. 2',
    artist: 'Oxide Atelier',
    description:
      'Color-field abstraction printed in ten passes. No two prints from this series are identical.',
  },
  {
    title: 'Signal Noise No. 8',
    artist: 'Oxide Atelier',
    description:
      'Analog noise mapped through a diffusion model and pressed onto organic heavyweight cotton.',
  },
];

// Pending auto-start timer handle
let autoStartTimer = null;

function cancelAutoStart() {
  if (autoStartTimer) {
    clearTimeout(autoStartTimer);
    autoStartTimer = null;
  }
}

function scheduleNextLot(delayMs) {
  cancelAutoStart();
  const clampedDelay = Math.max(0, delayMs);
  if (clampedDelay === 0) {
    console.log('[Scheduler] Auto-starting new lot immediately.');
    setImmediate(async () => {
      const latest = await prisma.lot.findFirst({
        where: { lotNumber: { gt: 0 } },
        orderBy: { lotNumber: 'desc' },
      });
      const nextNum = latest ? latest.lotNumber + 1 : 1;
      await createNewLot(nextNum);
    });
    return;
  }
  const minutes = Math.round(clampedDelay / 60000);
  console.log(`[Scheduler] Next lot auto-starts in ${minutes} minutes.`);
  autoStartTimer = setTimeout(async () => {
    autoStartTimer = null;
    const latest = await prisma.lot.findFirst({
      where: { lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'desc' },
    });
    const nextNum = latest ? latest.lotNumber + 1 : 1;
    await createNewLot(nextNum);
  }, clampedDelay);
}

async function closeActiveLot() {
  const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });
  if (!activeLot) {
    console.log('[Scheduler] No active lot to close.');
    return;
  }

  const bids = await prisma.bid.findMany({
    where: { lotId: activeLot.id },
    orderBy: { amount: 'desc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const distinctBidders = [];
  const seenUsers = new Set();
  for (const bid of bids) {
    if (!seenUsers.has(bid.userId)) {
      seenUsers.add(bid.userId);
      distinctBidders.push({
        userId: bid.userId,
        name: bid.user.name,
        email: bid.user.email,
        amount: bid.amount,
      });
    }
  }

  const topBid = distinctBidders[0] ?? null;
  const closedAt = new Date();

  await prisma.lot.update({
    where: { id: activeLot.id },
    data: {
      status: 'closed',
      endsAt: closedAt,
      winnerId: null,
      currentPayeeId: topBid?.userId ?? null,
      payeeExpiresAt: topBid ? new Date(Date.now() + 2 * 60 * 60 * 1000) : null,
      paymentStatus: topBid ? 'pending_1st' : null,
    },
  });

  console.log(`[Scheduler] Lot #${activeLot.lotNumber} closed. Highest bidder: ${topBid?.name ?? 'none'}`);

  getIo()?.emit('lot:closed', {
    lotId: activeLot.id,
    winner: topBid
      ? { userId: topBid.userId, name: topBid.name, amount: topBid.amount }
      : null,
  });

  if (topBid?.email) {
    await sendWinnerEmail(topBid, activeLot);
  }
  if (distinctBidders.length > 1 && distinctBidders[1].email) {
    await sendSecondPlaceEmail(distinctBidders[1], activeLot);
  }
  if (distinctBidders.length > 2 && distinctBidders[2].email) {
    await sendThirdPlaceEmail(distinctBidders[2], activeLot);
  }
  for (const bidder of distinctBidders.slice(3)) {
    if (bidder.email) await sendBetterLuckEmail(bidder, activeLot);
  }

  // Auto-start next lot after 6-hour gap
  scheduleNextLot(AUTO_RESTART_DELAY_MS);
}

async function createNewLot(lotNumber, preloadedArt = null) {
  // Cancel any pending auto-start since we're starting manually or via auto
  cancelAutoStart();

  const template = LOT_TEMPLATES[(lotNumber - 1) % LOT_TEMPLATES.length];
  const now = new Date();

  let art = preloadedArt ?? { artworkUrl: null, artworkHeadline: null, artworkPrompt: null };
  if (!preloadedArt) {
    try {
      art = await generateDailyArtwork(lotNumber);
    } catch (err) {
      console.error('[Scheduler] Failed to generate daily artwork:', err.message);
    }
  }

  const lot = await prisma.lot.create({
    data: {
      ...template,
      lotNumber,
      startsAt: now,
      endsAt: new Date(now.getTime() + BIDDING_DURATION_MS),
      startingBid: STARTING_BID,
      status: 'active',
      winnerId: null,
      currentPayeeId: null,
      payeeExpiresAt: null,
      paymentStatus: null,
      artworkUrl: art.artworkUrl,
      artworkHeadline: art.artworkHeadline,
      artworkPrompt: art.artworkPrompt,
    },
  });

  // Save the initial artwork as a draft linked to this lot so it appears in the studio
  if (art.artworkUrl || art.artworkHeadline) {
    await prisma.artworkDraft.create({
      data: {
        lotId: lot.id,
        artworkUrl: art.artworkUrl,
        artworkHeadline: art.artworkHeadline,
        artworkPrompt: art.artworkPrompt,
      },
    });
  }

  console.log(`[Scheduler] Lot #${lotNumber} created — bidding open for 18 hours.`);
  const totalLots = await prisma.lot.count({ where: { lotNumber: { gt: 0 } } });
  getIo()?.emit('lot:new', { lot: { ...lot, totalLots } });

  return lot;
}

async function checkPaymentExpirations() {
  const lot = await prisma.lot.findFirst({
    where: { status: { in: ['closed', 'hidden'] }, lotNumber: { gt: 0 } },
    orderBy: { lotNumber: 'desc' },
  });
  if (!lot) return;

  const hasExpired =
    lot.paymentStatus &&
    lot.paymentStatus.startsWith('pending_') &&
    lot.payeeExpiresAt &&
    new Date() > new Date(lot.payeeExpiresAt);

  if (!hasExpired) return;

  console.log(`[Scheduler] Payment window expired for lot #${lot.lotNumber}, payee: ${lot.currentPayeeId}`);

  const bids = await prisma.bid.findMany({
    where: { lotId: lot.id },
    orderBy: { amount: 'desc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const distinctBidders = [];
  const seenUsers = new Set();
  for (const bid of bids) {
    if (!seenUsers.has(bid.userId)) {
      seenUsers.add(bid.userId);
      distinctBidders.push({
        userId: bid.userId,
        name: bid.user.name,
        email: bid.user.email,
        amount: bid.amount,
      });
    }
  }

  if (lot.paymentStatus === 'pending_1st') {
    if (distinctBidders.length > 1) {
      const second = distinctBidders[1];
      await prisma.lot.update({
        where: { id: lot.id },
        data: {
          currentPayeeId: second.userId,
          payeeExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          paymentStatus: 'pending_2nd',
        },
      });
      console.log(`[Scheduler] Transitioned to 2nd payee: ${second.name}`);
      getIo()?.emit('lot:payee_changed', { lotId: lot.id });
      await sendPaymentLinkEmail(second, lot, '2nd');
    } else {
      await prisma.lot.update({
        where: { id: lot.id },
        data: { currentPayeeId: null, payeeExpiresAt: null, paymentStatus: 'expired' },
      });
      getIo()?.emit('lot:payee_changed', { lotId: lot.id });
    }
  } else if (lot.paymentStatus === 'pending_2nd') {
    if (distinctBidders.length > 2) {
      const third = distinctBidders[2];
      await prisma.lot.update({
        where: { id: lot.id },
        data: {
          currentPayeeId: third.userId,
          payeeExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          paymentStatus: 'pending_3rd',
        },
      });
      console.log(`[Scheduler] Transitioned to 3rd payee: ${third.name}`);
      getIo()?.emit('lot:payee_changed', { lotId: lot.id });
      await sendPaymentLinkEmail(third, lot, '3rd');
    } else {
      await prisma.lot.update({
        where: { id: lot.id },
        data: { currentPayeeId: null, payeeExpiresAt: null, paymentStatus: 'expired' },
      });
      getIo()?.emit('lot:payee_changed', { lotId: lot.id });
    }
  } else if (lot.paymentStatus === 'pending_3rd') {
    await prisma.lot.update({
      where: { id: lot.id },
      data: { currentPayeeId: null, payeeExpiresAt: null, paymentStatus: 'expired' },
    });
    console.log(`[Scheduler] 3rd payee expired. No more settlement slots.`);
    getIo()?.emit('lot:payee_changed', { lotId: lot.id });
  }
}

async function sendWinnerEmail(winner, lot) {
  const { name, email, amount } = winner;
  const title = getLotTitle(lot);
  const dateStr = lotDateStr(lot);
  const no = lotNo(lot);
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Email Mock] Winner: ${name} (${email})
Subject: You won today's auction! 🏆
"${title}" by ${lot.artist} · Lot #${no} · ${dateStr}
Winning Bid: ₹${amount.toLocaleString('en-IN')} · Pay within 2 hours
============================================================
    `);
    return;
  }

  try {
    await resend.emails.send({
      from: 'Oxide Auction <no-reply@oxide.chemicalfarmers.com>',
      to: email,
      subject: `You won today's auction! 🏆`,
      html: emailWrapper(`
        <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 21px;">Congratulations, ${escHtml(name)}! 🏆</h2>
        <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 20px;">You have won today's Oxide auction.</p>
        ${productImageBlock(lot)}
        <div style="margin-bottom: 4px;">
          <div style="font-size: 19px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${escHtml(title)}</div>
          ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${escHtml(lot.artist)}</div>` : ''}
          <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
            ${dateStr} · Lot #${no} · Edition 1/1
          </div>
        </div>
        <div style="background: rgba(230,194,126,0.05); border: 1px solid rgba(230,194,126,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #7d7a8c; font-size: 13px; padding-bottom: 10px;">Winning Bid</td>
              <td style="color: #e6c27e; font-size: 18px; font-weight: 700; text-align: right; padding-bottom: 10px;">₹${amount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td style="color: #7d7a8c; font-size: 13px;">Payment Deadline</td>
              <td style="color: #ff6b7d; font-size: 14px; font-weight: 700; text-align: right;">2 Hours · Strict</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 13px; line-height: 1.6; color: #7d7a8c; margin: 0 0 4px;">
          If payment is not completed within 2 hours, the opportunity passes to the next highest bidder.
        </p>
        ${appUrl ? ctaButton('Complete Payment', `${appUrl}/pay`) : ''}
      `),
    });
  } catch (err) {
    console.error('[Scheduler] Error sending winner email:', err);
  }
}

async function sendSecondPlaceEmail(bidder, lot) {
  const { name, email } = bidder;
  const title = getLotTitle(lot);
  const no = lotNo(lot);
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Email Mock] 2nd Place: ${name} (${email})
Subject: You almost had it! ⚡ — "${title}" · Lot #${no}
The top bidder has 2 hours to pay. You'll be notified if the opportunity shifts.
============================================================
    `);
    return;
  }

  try {
    await resend.emails.send({
      from: 'Oxide Auction <no-reply@oxide.chemicalfarmers.com>',
      to: email,
      subject: `You almost had it! ⚡`,
      html: emailWrapper(`
        <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 20px;">This was close, ${escHtml(name)}! ⚡</h2>
        <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 20px;">You were the 2nd highest bidder on today's drop.</p>
        ${productImageBlock(lot)}
        <div style="margin-bottom: 4px;">
          <div style="font-size: 18px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${escHtml(title)}</div>
          ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${escHtml(lot.artist)}</div>` : ''}
          <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
            Lot #${no} · Edition 1/1
          </div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; margin: 20px 0; line-height: 1.7;">
          <p style="font-size: 14px; color: #b9b6c4; margin: 0 0 10px;">
            The top bidder has a <strong style="color: #f4f1ea;">2-hour window</strong> to complete their payment.
          </p>
          <p style="font-size: 14px; color: #b9b6c4; margin: 0;">
            If they don't pay in time, the opportunity to claim this drop shifts directly to you — we'll send you a payment link immediately. Keep an eye on your inbox!
          </p>
        </div>
        ${appUrl ? ctaButton('View Auction', appUrl, '#b9b6c4') : ''}
      `),
    });
  } catch (err) {
    console.error('[Scheduler] Error sending 2nd place email:', err);
  }
}

async function sendThirdPlaceEmail(bidder, lot) {
  const { name, email } = bidder;
  const title = getLotTitle(lot);
  const no = lotNo(lot);
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Email Mock] 3rd Place: ${name} (${email})
Subject: You're 3rd in line — "${title}" · Lot #${no}
Both top bidders have 2 hours each to pay. You'll be notified if the opportunity reaches you.
============================================================
    `);
    return;
  }

  try {
    await resend.emails.send({
      from: 'Oxide Auction <no-reply@oxide.chemicalfarmers.com>',
      to: email,
      subject: `You're 3rd in line for today's drop`,
      html: emailWrapper(`
        <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 20px;">You're 3rd in line, ${escHtml(name)}.</h2>
        <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 20px;">You were the 3rd highest bidder on today's drop.</p>
        ${productImageBlock(lot)}
        <div style="margin-bottom: 4px;">
          <div style="font-size: 18px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${escHtml(title)}</div>
          ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${escHtml(lot.artist)}</div>` : ''}
          <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
            Lot #${no} · Edition 1/1
          </div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; margin: 20px 0; line-height: 1.7;">
          <p style="font-size: 14px; color: #b9b6c4; margin: 0 0 10px;">
            The top two bidders each have a <strong style="color: #f4f1ea;">2-hour window</strong> to complete their payment — in order.
          </p>
          <p style="font-size: 14px; color: #b9b6c4; margin: 0;">
            If neither of them pays, this drop comes to you. We'll send you a payment link the moment that happens — keep an eye on your inbox.
          </p>
        </div>
        ${appUrl ? ctaButton('View Auction', appUrl, '#b9b6c4') : ''}
      `),
    });
  } catch (err) {
    console.error('[Scheduler] Error sending 3rd place email:', err);
  }
}

async function sendBetterLuckEmail(bidder, lot) {
  const { name, email } = bidder;
  const title = getLotTitle(lot);
  const no = lotNo(lot);
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Email Mock] Better Luck: ${name} (${email})
Subject: Better luck next time — "${title}" · Lot #${no}
============================================================
    `);
    return;
  }

  try {
    await resend.emails.send({
      from: 'Oxide Auction <no-reply@oxide.chemicalfarmers.com>',
      to: email,
      subject: `Better luck next time`,
      html: emailWrapper(`
        <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 20px;">Better luck next time, ${escHtml(name)}.</h2>
        <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 20px;">Today's auction has ended and the top three bidders have first claim on this drop.</p>
        ${productImageBlock(lot)}
        <div style="margin-bottom: 4px;">
          <div style="font-size: 18px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${escHtml(title)}</div>
          ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${escHtml(lot.artist)}</div>` : ''}
          <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
            Lot #${no} · Edition 1/1
          </div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; margin: 20px 0; line-height: 1.7;">
          <p style="font-size: 14px; color: #b9b6c4; margin: 0;">
            A new drop goes live every day. Show up early, bid strong — the next one is yours to win.
          </p>
        </div>
        ${appUrl ? ctaButton('See Tomorrow\'s Drop', appUrl, '#b9b6c4') : ''}
      `),
    });
  } catch (err) {
    console.error('[Scheduler] Error sending better luck email:', err);
  }
}

async function sendPaymentLinkEmail(bidder, lot, rank) {
  const { name, email, amount } = bidder;
  const title = getLotTitle(lot);
  const dateStr = lotDateStr(lot);
  const no = lotNo(lot);
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Email Mock] ${rank} Place Claim Offer: ${name} (${email})
Subject: Your opportunity to claim "${title}"! 🏆
Previous bidder defaulted. You have 2 hours to pay ₹${amount.toLocaleString('en-IN')}.
============================================================
    `);
    return;
  }

  try {
    await resend.emails.send({
      from: 'Oxide Auction <no-reply@oxide.chemicalfarmers.com>',
      to: email,
      subject: `Your opportunity to claim today's drop! 🏆`,
      html: emailWrapper(`
        <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 20px;">Your Opportunity Has Arrived!</h2>
        <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 20px;">Hi ${escHtml(name)}, you're next in line for today's drop.</p>
        ${productImageBlock(lot)}
        <div style="margin-bottom: 4px;">
          <div style="font-size: 18px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${escHtml(title)}</div>
          ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${escHtml(lot.artist)}</div>` : ''}
          <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
            ${dateStr} · Lot #${no} · Edition 1/1
          </div>
        </div>
        <p style="font-size: 14px; color: #b9b6c4; margin: 16px 0 0; line-height: 1.6;">
          The previous bidder failed to pay on time. As the next highest bidder, you can now claim this drop.
        </p>
        <div style="background: rgba(230,194,126,0.05); border: 1px solid rgba(230,194,126,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #7d7a8c; font-size: 13px; padding-bottom: 10px;">Claim Price</td>
              <td style="color: #e6c27e; font-size: 18px; font-weight: 700; text-align: right; padding-bottom: 10px;">₹${amount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td style="color: #7d7a8c; font-size: 13px;">Payment Deadline</td>
              <td style="color: #ff6b7d; font-size: 14px; font-weight: 700; text-align: right;">2 Hours · Strict</td>
            </tr>
          </table>
        </div>
        ${appUrl ? ctaButton('Claim Now', `${appUrl}/pay`) : ''}
        <p style="font-size: 12px; color: #4d4a5c; text-align: center; margin: 12px 0 0;">
          If you don't pay within 2 hours, the opportunity passes to the next bidder.
        </p>
      `),
    });
  } catch (err) {
    console.error('[Scheduler] Error sending transition email:', err);
  }
}

export async function startScheduler() {
  const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });

  if (activeLot) {
    if (new Date(activeLot.endsAt) < new Date()) {
      // Lot expired while server was down — close it and schedule next lot
      const originalEndsAt = new Date(activeLot.endsAt);
      console.log('[Scheduler] Active lot expired on startup — closing now');
      await closeActiveLot();
      // Adjust the auto-start timer based on original expiry, not now
      const elapsed = Date.now() - originalEndsAt.getTime();
      scheduleNextLot(AUTO_RESTART_DELAY_MS - elapsed);
    }
    // else: lot is still active, let it run naturally
  } else {
    const latestLot = await prisma.lot.findFirst({
      where: { lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'desc' },
    });
    if (!latestLot) {
      // First run ever
      await createNewLot(1);
    } else {
      // No active lot — resume the 6h countdown based on when the last lot closed
      const closedAt = new Date(latestLot.endsAt);
      const elapsed = Date.now() - closedAt.getTime();
      scheduleNextLot(AUTO_RESTART_DELAY_MS - elapsed);
    }
  }

  // Every minute: check if active lot has expired naturally
  cron.schedule('* * * * *', async () => {
    const lot = await prisma.lot.findFirst({ where: { status: 'active' } });
    if (lot && new Date(lot.endsAt) < new Date()) {
      console.log('[Scheduler] Lot expired naturally — closing');
      await closeActiveLot();
    }
  });

  // Every minute: check payment window expirations
  cron.schedule('* * * * *', async () => {
    await checkPaymentExpirations();
  });

  // Every 30 minutes: poll Qikink for order status updates (printing → shipped → delivered)
  cron.schedule('*/30 * * * *', async () => {
    await pollQikinkOrders().catch((e) => console.error('[Scheduler] Qikink poll error:', e.message));
  });

  console.log('[Scheduler] Event-driven scheduler active — 12h bidding, 6h gap.');
}

export { closeActiveLot, checkPaymentExpirations, createNewLot };
