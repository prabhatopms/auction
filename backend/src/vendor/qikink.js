import { Resend } from 'resend';
import { prisma } from '../prisma.js';
import { getLotTitle, lotNo, getAppUrl, productImageBlock, ctaButton, emailWrapper } from '../email-helpers.js';

export { getLotTitle } from '../email-helpers.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const BASE_URL = process.env.QIKINK_SANDBOX === 'true'
  ? 'https://sandbox.qikink.com'
  : 'https://api.qikink.com';

// In-memory token cache
let _cachedToken = null;
let _tokenExpiresAt = 0;

async function _getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken;

  const res = await fetch(`${BASE_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ClientId: process.env.QIKINK_CLIENT_ID,
      client_secret: process.env.QIKINK_CLIENT_SECRET,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.Accesstoken) throw new Error(data.error || 'Qikink auth failed');

  _cachedToken = data.Accesstoken;
  _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

// Qikink SKUs are size-specific: the base SKU encodes product + color + size.
// Set QIKINK_SKU_MAP as JSON in env, e.g.:
//   {"XS":"MVnHs-Wh-XS","S":"MVnHs-Wh-S","M":"MVnHs-Wh-M","L":"MVnHs-Wh-L","XL":"MVnHs-Wh-XL","XXL":"MVnHs-Wh-XXL"}
// Or set QIKINK_SKU as a fallback default SKU for all sizes.
function _skuForSize(size) {
  const map = process.env.QIKINK_SKU_MAP ? JSON.parse(process.env.QIKINK_SKU_MAP) : {};
  return map[size] || process.env.QIKINK_SKU || 'MVnHs-Wh-M';
}

const QIKINK_STATUS_MAP = {
  confirmed: 'processing',
  printing: 'printing',
  printed: 'printing',
  shipped: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
};

// Called by the scheduler every 30 minutes to sync order status from Qikink.
export async function pollQikinkOrders() {
  if (!process.env.QIKINK_CLIENT_ID || !process.env.QIKINK_CLIENT_SECRET) return;

  const orders = await prisma.order.findMany({
    where: {
      vendorOrderId: { not: null },
      status: { notIn: ['delivered'] },
    },
    include: {
      lot: true,
      address: true,
      user: { select: { email: true, name: true } },
    },
  });

  if (!orders.length) return;

  let token;
  try {
    token = await _getAccessToken();
  } catch (e) {
    console.error('[Vendor] Qikink token fetch failed during poll:', e.message);
    return;
  }

  for (const order of orders) {
    try {
      const res = await fetch(`${BASE_URL}/api/order?id=${order.vendorOrderId}`, {
        headers: { ClientId: process.env.QIKINK_CLIENT_ID, Accesstoken: token },
      });
      if (!res.ok) continue;

      const data = await res.json();
      const rawStatus = (data.status || data.order_status || '').toLowerCase().replace(/\s+/g, '_');
      const mappedStatus = QIKINK_STATUS_MAP[rawStatus];
      if (!mappedStatus || mappedStatus === order.status) continue;

      const now = new Date();
      const update = { status: mappedStatus };
      if (mappedStatus === 'printing' && !order.printedAt) update.printedAt = now;
      if (mappedStatus === 'shipped' && !order.shippedAt) {
        update.shippedAt = now;
        if (data.carrier || data.courier) update.carrier = data.carrier || data.courier;
        if (data.tracking_number || data.awb) update.trackingNumber = data.tracking_number || data.awb;
        if (data.tracking_url) update.trackingUrl = data.tracking_url;
      }
      if (mappedStatus === 'delivered' && !order.deliveredAt) update.deliveredAt = now;

      await prisma.order.update({ where: { id: order.id }, data: update });
      console.log(`[Vendor] Order ${order.orderNumber} status: ${order.status} → ${mappedStatus}`);

      if (mappedStatus === 'shipped') {
        const updatedOrder = { ...order, ...update };
        sendShippingEmail(updatedOrder, order.lot, order.address, order.user.email, order.user.name)
          .catch((e) => console.error('[Vendor] Shipping email failed:', e.message));
      }
    } catch (e) {
      console.error(`[Vendor] Poll failed for order ${order.orderNumber}:`, e.message);
    }
  }
}

export async function notifyVendor(order, lot, address, userEmail, backImageUrl, frontImageUrl) {
  if (process.env.QIKINK_CLIENT_ID && process.env.QIKINK_CLIENT_SECRET) {
    return await _callQikinkApi(order, lot, address, userEmail, backImageUrl, frontImageUrl);
  }
  await _sendVendorEmail(order, lot, address);
  return null;
}

async function _callQikinkApi(order, lot, address, userEmail, backImageUrl, frontImageUrl) {
  try {
    const token = await _getAccessToken();
    const size = order.tshirtSize || 'M';

    // Failsafe: Fetch user's email if not passed by caller
    let email = userEmail;
    if (!email) {
      const user = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { email: true },
      });
      email = user?.email;
    }
    email = email || 'customer@chemicalfarmers.com';

    // Split name into first/last for Qikink's address schema
    const nameParts = (address.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || address.name;
    const lastName = nameParts.slice(1).join(' ') || '';

    // design_code doubles as a stable ID for this lot's design in Qikink's system.
    // Passing a new code auto-creates the design; passing an existing one reuses it.
    // Versioned print files (front-print/lot-N-{ts}.png) carry their version into
    // the code so a resend after an artwork swap doesn't reuse Qikink's cached design.
    const frontUrl = frontImageUrl || lot.frontPrintUrl || lot.artworkUrl || '';
    const version = (frontUrl.match(/lot--?\d+-(\d+)\.png$/) || [])[1];
    const designCode = version ? `oxidelot${lot.lotNumber}v${version}` : `oxidelot${lot.lotNumber}`;

    const payload = {
      order_number: order.orderNumber.replace(/-/g, ''),
      qikink_shipping: '1',
      gateway: 'Prepaid',
      total_order_value: String(Math.round(order.amount / 100)),
      line_items: [
        {
          search_from_my_products: 0,
          print_type_id: 1, // DTG
          quantity: '1',
          price: String(Math.round(order.amount / 100)),
          sku: _skuForSize(size),
          designs: [
            {
              design_code: designCode,
              // Standard front-chest DTG print area. Required for new design_codes.
              width_inches: '10',
              height_inches: '12',
              placement_sku: 'fr',
              design_link: frontUrl,
              // mockup_link is only shown in Qikink's dashboard, not used for printing.
              // We don't generate t-shirt mockups so we reuse the print file URL.
              mockup_link: frontUrl,
            },
            ...(backImageUrl ? [{
              design_code: `${designCode}-bk`,
              width_inches: '10',
              height_inches: '12',
              placement_sku: 'bk',
              design_link: backImageUrl,
              mockup_link: backImageUrl,
            }] : []),
          ],
        },
      ],
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address1: address.line1,
        address2: address.line2 || '',
        phone: address.phone,
        email: email,
        city: address.city,
        zip: address.pincode,
        province: address.state,
        country_code: 'IN',
      },
    };

    const response = await fetch(`${BASE_URL}/api/order/create`, {
      method: 'POST',
      headers: {
        ClientId: process.env.QIKINK_CLIENT_ID,
        Accesstoken: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || 'Qikink API error');

    const vendorOrderId = String(data.order_id || data.id || '');
    if (vendorOrderId) {
      await prisma.order.update({ where: { id: order.id }, data: { vendorOrderId } });
    }
    return vendorOrderId;
  } catch (err) {
    console.error('[Vendor] Qikink API call failed, falling back to email:', err.message);
    await _sendVendorEmail(order, lot, address);
    return null;
  }
}

async function _sendVendorEmail(order, lot, address) {
  const vendorEmail = process.env.VENDOR_EMAIL;
  const title = getLotTitle(lot);
  const addressText = [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY || !vendorEmail) {
    console.log(`
============================================================
[Vendor Email Mock]
To: ${vendorEmail || 'vendor@example.com'}
Subject: New Order: ${order.orderNumber} — ${title}
Order #: ${order.orderNumber} | Lot #${lotNo(lot)}
Product: ${title} — Size: ${order.tshirtSize || lot.size}
Amount: ₹${(order.amount / 100).toLocaleString('en-IN')}
Ship to: ${address.name} · ${addressText} · ${address.phone}
============================================================
    `);
    return;
  }

  await resend.emails.send({
    from: 'Oxide Auction <otp@oxide.chemicalfarmers.com>',
    to: vendorEmail,
    subject: `New Order: ${order.orderNumber} — ${title}`,
    html: emailWrapper(`
      <h2 style="color: #e6c27e; margin: 0 0 4px;">New Order Received</h2>
      <p style="color: #7d7a8c; font-size: 12px; margin: 0 0 20px; letter-spacing: 0.06em;">Lot #${lotNo(lot)}</p>
      ${productImageBlock(lot)}
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">Order #</td>
            <td style="color: #e6c27e; font-weight: 700; text-align: right; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace;">${order.orderNumber}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">Product</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">${title}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">Size</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">${order.tshirtSize || lot.size || '—'}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">Amount</td>
            <td style="color: #e6c27e; font-weight: 700; text-align: right; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">₹${(order.amount / 100).toLocaleString('en-IN')}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; vertical-align: top;">Ship to</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0; line-height: 1.7;">${address.name}<br>${addressText}<br>${address.phone}</td></tr>
      </table>
      <p style="font-size: 13px; color: #7d7a8c; margin: 0 0 4px;">Please process and ship this order, then update the tracking details.</p>
      ${appUrl ? ctaButton('Manage Orders', `${appUrl}/admin`, '#e6c27e') : ''}
    `),
  });
}

export async function sendShippingEmail(order, lot, address, userEmail, userName) {
  const title = getLotTitle(lot);
  const addressText = [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Shipping Email Mock] To: ${userEmail}
${title} — Order ${order.orderNumber} shipped via ${order.carrier || 'carrier'} — Tracking: ${order.trackingNumber || 'N/A'}
${order.trackingUrl ? 'Track: ' + order.trackingUrl : ''}
============================================================
    `);
    return;
  }

  const trackingBlock = order.trackingNumber
    ? `<div style="background: rgba(74,222,128,0.05); border: 1px solid rgba(74,222,128,0.2); border-radius: 8px; padding: 16px; margin: 20px 0;">
        <div style="color: #7d7a8c; font-size: 11px; letter-spacing: 0.08em; margin-bottom: 8px;">TRACKING INFO</div>
        ${order.carrier ? `<div style="color: #b9b6c4; font-size: 13px; margin-bottom: 4px;">Carrier: <strong style="color: #f4f1ea;">${order.carrier}</strong></div>` : ''}
        <div style="color: #4ade80; font-size: 16px; font-weight: 700; font-family: monospace; margin-bottom: 10px;">${order.trackingNumber}</div>
        ${order.trackingUrl ? `<a href="${order.trackingUrl}" style="display: inline-block; padding: 8px 18px; background: rgba(74,222,128,0.15); color: #4ade80; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;">Track your package →</a>` : ''}
      </div>`
    : '';

  await resend.emails.send({
    from: 'Oxide Auction <otp@oxide.chemicalfarmers.com>',
    to: userEmail,
    subject: `Your Oxide order ${order.orderNumber} has shipped! 🚚`,
    html: emailWrapper(`
      <h2 style="color: #4ade80; margin: 0 0 16px; font-size: 20px;">Your order is on its way! 🚚</h2>
      ${productImageBlock(lot)}
      <p style="font-size: 15px; color: #b9b6c4; margin: 0 0 4px;">
        Hi ${userName}, <strong style="color: #f4f1ea;">${title}</strong> has been shipped and is heading to you.
      </p>
      <p style="font-size: 12px; color: #7d7a8c; margin: 0 0 16px; font-family: monospace;">Order #${order.orderNumber}</p>
      ${trackingBlock}
      <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 14px; margin: 20px 0;">
        <div style="color: #7d7a8c; font-size: 11px; letter-spacing: 0.08em; margin-bottom: 8px;">SHIPPING TO</div>
        <div style="color: #f4f1ea; font-size: 14px; line-height: 1.7;">${address.name}<br>
          <span style="color: #b9b6c4;">${addressText}</span><br>
          <span style="color: #7d7a8c;">${address.phone}</span>
        </div>
      </div>
      ${appUrl ? ctaButton('View Your Orders', `${appUrl}/orders`, '#4ade80') : ''}
    `),
  });
}

export async function sendInvoiceEmail(order, lot, address, userEmail, userName) {
  const title = getLotTitle(lot);
  const addressText = [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  const paidDate = new Date(order.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const appUrl = getAppUrl();

  if (!process.env.RESEND_API_KEY) {
    console.log(`
============================================================
[Invoice Email Mock] To: ${userEmail}
${title} — Order ${order.orderNumber} confirmed — ₹${(order.amount / 100).toLocaleString('en-IN')}
============================================================
    `);
    return;
  }

  await resend.emails.send({
    from: 'Oxide Auction <otp@oxide.chemicalfarmers.com>',
    to: userEmail,
    subject: `Your Oxide order ${order.orderNumber} is confirmed ✦`,
    html: emailWrapper(`
      <h2 style="color: #e6c27e; margin: 0 0 4px; font-size: 20px;">Order Confirmed ✦</h2>
      <p style="font-size: 14px; color: #7d7a8c; margin: 0 0 20px;">Hi ${userName}, your order is confirmed and being prepared.</p>
      ${productImageBlock(lot)}
      <div style="margin-bottom: 6px;">
        <div style="font-size: 18px; font-weight: 700; color: #f4f1ea; line-height: 1.3;">${title}</div>
        ${lot.artist ? `<div style="font-size: 13px; color: #7d7a8c; margin-top: 2px;">by ${lot.artist}</div>` : ''}
        <div style="font-size: 11px; color: #4d4a5c; margin-top: 4px; font-family: monospace; letter-spacing: 0.06em;">
          Lot #${lotNo(lot)} · Edition 1/1${order.tshirtSize ? ' · ' + order.tshirtSize : ''}
        </div>
      </div>
      <div style="background: rgba(230,194,126,0.05); border: 1px solid rgba(230,194,126,0.15); border-radius: 8px; padding: 16px; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="color: #7d7a8c; font-size: 13px; padding-bottom: 8px;">Order Number</td>
              <td style="color: #e6c27e; font-weight: 700; text-align: right; padding-bottom: 8px; font-family: monospace;">${order.orderNumber}</td></tr>
          <tr><td style="color: #7d7a8c; font-size: 13px; padding-bottom: 8px;">Amount Paid</td>
              <td style="color: #e6c27e; font-size: 17px; font-weight: 700; text-align: right; padding-bottom: 8px;">₹${(order.amount / 100).toLocaleString('en-IN')}</td></tr>
          <tr><td style="color: #7d7a8c; font-size: 13px;">Date</td>
              <td style="color: #b9b6c4; text-align: right; font-size: 13px;">${paidDate}</td></tr>
        </table>
      </div>
      <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 14px; margin-bottom: 20px;">
        <div style="color: #7d7a8c; font-size: 11px; letter-spacing: 0.08em; margin-bottom: 8px;">SHIPPING TO</div>
        <div style="color: #f4f1ea; font-size: 14px; line-height: 1.7;">${address.name}<br>
          <span style="color: #b9b6c4;">${addressText}</span><br>
          <span style="color: #7d7a8c;">${address.phone}</span>
        </div>
      </div>
      ${appUrl ? ctaButton('View Your Orders', `${appUrl}/orders`) : ''}
      <p style="font-size: 12px; color: #4d4a5c; text-align: center; margin: 16px 0 0;">
        We'll email you again once your item ships with full tracking info.
      </p>
    `),
  });
}
