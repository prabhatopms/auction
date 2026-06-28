import { prisma } from '../prisma.js';
import { Resend } from 'resend';
import { getLotTitle, lotNo, getAppUrl, productImageBlock, ctaButton, emailWrapper } from '../email-helpers.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE = 'https://api.printful.com';

// Printful variant IDs are numeric and product-specific.
// Set PRINTFUL_VARIANT_MAP as JSON: {"S":4012,"M":4013,"L":4014,"XL":4015,"XXL":4016}
// These IDs depend on which product you've set up in your Printful store.
function _variantForSize(size) {
  const map = process.env.PRINTFUL_VARIANT_MAP ? JSON.parse(process.env.PRINTFUL_VARIANT_MAP) : {};
  return map[size] || map['M'] || parseInt(process.env.PRINTFUL_VARIANT_ID || '0', 10);
}

function _authHeaders() {
  const h = {
    Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
  return h;
}

export async function placeOrder(order, address, artworkUrl) {
  if (!process.env.PRINTFUL_API_KEY) {
    await _sendVendorEmail(order, address, artworkUrl);
    return { vendorOrderId: 'printful-pending-' + order.orderNumber };
  }
  try {
    return await _callApi(order, address, artworkUrl);
  } catch (err) {
    console.error('[Printful] API call failed, falling back to email:', err.message);
    await _sendVendorEmail(order, address, artworkUrl);
    return { vendorOrderId: 'printful-pending-' + order.orderNumber };
  }
}

async function _callApi(order, address, artworkUrl) {
  const size = order.tshirtSize || 'M';
  const variantId = _variantForSize(size);
  if (!variantId) throw new Error('No Printful variant ID configured for size ' + size);

  // Fetch user email if not on the order object
  let userEmail = order.userEmail;
  if (!userEmail && order.userId) {
    const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
    userEmail = user?.email;
  }

  const payload = {
    external_id: order.orderNumber,
    recipient: {
      name: address.name,
      email: userEmail || '',
      phone: address.phone || '',
      address1: address.line1,
      address2: address.line2 || '',
      city: address.city,
      state_code: address.state || '',
      country_code: address.country || 'US',
      zip: address.pincode,
    },
    items: [
      {
        variant_id: variantId,
        quantity: 1,
        retail_price: String((order.amount / 100).toFixed(2)),
        files: [{ type: 'default', url: artworkUrl }],
      },
    ],
  };

  // confirm=true auto-confirms the order instead of leaving it as a draft
  const res = await fetch(`${BASE}/orders?confirm=true`, {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.result || data.error?.message || 'Printful API error');

  const vendorOrderId = String(data.result?.id || '');
  if (vendorOrderId) {
    await prisma.order.update({ where: { id: order.id }, data: { vendorOrderId } });
  }
  console.log(`[Printful] Order created: ${order.orderNumber} → Printful ID ${vendorOrderId}`);
  return { vendorOrderId };
}

export async function getOrderStatus(vendorOrderId) {
  if (!process.env.PRINTFUL_API_KEY || !vendorOrderId || vendorOrderId.startsWith('printful-pending-')) {
    return { status: null };
  }

  const res = await fetch(`${BASE}/orders/${vendorOrderId}`, { headers: _authHeaders() });
  if (!res.ok) return { status: null };

  const data = await res.json();
  const pf = data.result;
  const shipment = pf?.shipments?.[0];

  return {
    status: pf?.status || null,
    trackingNumber: shipment?.tracking_number || null,
    trackingUrl: shipment?.tracking_url || null,
    carrier: shipment?.carrier || null,
  };
}

export function mapStatus(s) {
  const map = {
    draft: 'processing',
    pending: 'processing',
    onhold: 'processing',
    inprocess: 'printing',
    partial: 'shipped',
    fulfilled: 'shipped',
  };
  return map[(s || '').toLowerCase()] || null;
}

async function _sendVendorEmail(order, address, artworkUrl) {
  const vendorEmail = process.env.PRINTFUL_VENDOR_EMAIL || process.env.VENDOR_EMAIL;
  let lot = null;
  try {
    lot = await prisma.lot.findUnique({ where: { id: order.lotId } });
  } catch { /* best-effort */ }

  const title = lot ? getLotTitle(lot) : (order.orderNumber || 'Order');
  const addressText = [address.line1, address.line2, address.city, address.state, address.pincode, address.country]
    .filter(Boolean).join(', ');
  const appUrl = getAppUrl();
  const art = artworkUrl || lot?.artworkUrl || '';

  if (!process.env.RESEND_API_KEY || !vendorEmail) {
    console.log(`
============================================================
[Printful Vendor Email Mock]
To: ${vendorEmail || 'printful@example.com'}
Order #: ${order.orderNumber}${lot ? ` | Lot #${lotNo(lot)}` : ''}
Product: ${title} — Size: ${order.tshirtSize || lot?.size || 'M'}
Ship to: ${address.name} · ${addressText} · ${address.phone}
Artwork: ${art}
============================================================
    `);
    return;
  }

  await resend.emails.send({
    from: 'Oxide Auction <otp@oxide.chemicalfarmers.com>',
    to: vendorEmail,
    subject: `New Order (Printful): ${order.orderNumber} — ${title}`,
    html: emailWrapper(`
      <h2 style="color: #e6c27e; margin: 0 0 4px;">New Printful Order</h2>
      ${lot ? `<p style="color: #7d7a8c; font-size: 12px; margin: 0 0 20px; letter-spacing: 0.06em;">Lot #${lotNo(lot)}</p>` : ''}
      ${lot ? productImageBlock(lot) : ''}
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0;">Order #</td>
            <td style="color: #e6c27e; font-weight: 700; text-align: right; padding: 8px 0; font-family: monospace;">${order.orderNumber}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0;">Product</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0;">${title}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0;">Size</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0;">${order.tshirtSize || lot?.size || '—'}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0; vertical-align: top;">Ship to</td>
            <td style="color: #f4f1ea; text-align: right; padding: 8px 0; line-height: 1.7;">${address.name}<br>${addressText}<br>${address.phone}</td></tr>
        <tr><td style="color: #7d7a8c; font-size: 13px; padding: 8px 0;">Artwork</td>
            <td style="text-align: right; padding: 8px 0;">${art ? `<a href="${art}" style="color: #e6c27e;">View artwork</a>` : '—'}</td></tr>
      </table>
      ${appUrl ? ctaButton('Manage Orders', `${appUrl}/admin`, '#e6c27e') : ''}
    `),
  });
}
