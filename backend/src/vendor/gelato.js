import { prisma } from '../prisma.js';
import { Resend } from 'resend';
import { getLotTitle, lotNo, getAppUrl, productImageBlock, ctaButton, emailWrapper } from '../email-helpers.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE = 'https://order.gelatoapis.com';

// Gelato product UIDs encode the full product spec as a structured string.
// Default: classic unisex crewneck, front-only print (4-0), color from GELATO_PRODUCT_COLOR (default: black).
// Override individual sizes with GELATO_PRODUCT_UID_MAP JSON: {"M":"apparel_product_..."}
// When a back-print image exists, GELATO_PRODUCT_UID_MAP_BOTH_SIDES supplies the matching
// front+back (gpr_4-4) product UID per size — these are distinct catalog products, not a flag.
function _productUidForSize(size, hasBack) {
  const mapKey = hasBack ? 'GELATO_PRODUCT_UID_MAP_BOTH_SIDES' : 'GELATO_PRODUCT_UID_MAP';
  const map = process.env[mapKey] ? JSON.parse(process.env[mapKey]) : {};
  if (map[size]) return map[size];
  const s = (size || 'M').toLowerCase().replace('xxl', '2xl').replace('xxxl', '3xl');
  const color = process.env.GELATO_PRODUCT_COLOR || 'black';
  const gpr = hasBack ? '4-4' : '4-0';
  return `apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_classic_gsi_${s}_gco_${color}_gpr_${gpr}`;
}

export async function placeOrder(order, address, artworkUrl, backImageUrl) {
  if (!process.env.GELATO_API_KEY) {
    await _sendVendorEmail(order, address, artworkUrl);
    return { vendorOrderId: 'gelato-pending-' + order.orderNumber };
  }
  try {
    return await _callApi(order, address, artworkUrl, backImageUrl);
  } catch (err) {
    console.error('[Gelato] API call failed, falling back to email:', err.message);
    await _sendVendorEmail(order, address, artworkUrl);
    return { vendorOrderId: 'gelato-pending-' + order.orderNumber };
  }
}

async function _callApi(order, address, artworkUrl, backImageUrl) {
  const size = order.tshirtSize || 'M';

  // Fetch user email if not on the order object
  let userEmail = order.userEmail;
  if (!userEmail && order.userId) {
    const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
    userEmail = user?.email;
  }

  const nameParts = (address.name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || address.name;
  const lastName = nameParts.slice(1).join(' ') || '';

  const payload = {
    orderType: 'order',
    orderReferenceId: order.orderNumber,
    currency: 'EUR',
    items: [
      {
        itemReferenceId: `${order.orderNumber}-1`,
        productUid: _productUidForSize(size, !!backImageUrl),
        files: [
          { type: 'default', url: artworkUrl },
          ...(backImageUrl ? [{ type: 'back', url: backImageUrl }] : []),
        ],
        quantity: 1,
      },
    ],
    shipmentMethodUid: 'normal',
    shippingAddress: {
      firstName,
      lastName,
      addressLine1: address.line1,
      addressLine2: address.line2 || '',
      city: address.city,
      state: address.state || '',
      postCode: address.pincode,
      country: address.country || 'DE',
      email: userEmail || '',
      phone: address.phone || '',
    },
  };

  const res = await fetch(`${BASE}/v4/orders`, {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.GELATO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data) || 'Gelato API error');

  const vendorOrderId = data.id || '';
  if (vendorOrderId) {
    await prisma.order.update({ where: { id: order.id }, data: { vendorOrderId } });
  }
  console.log(`[Gelato] Order created: ${order.orderNumber} → Gelato ID ${vendorOrderId}`);
  return { vendorOrderId };
}

export async function getOrderStatus(vendorOrderId) {
  if (!process.env.GELATO_API_KEY || !vendorOrderId || vendorOrderId.startsWith('gelato-pending-')) {
    return { status: null };
  }

  const res = await fetch(`${BASE}/v4/orders/${vendorOrderId}`, {
    headers: { 'X-API-KEY': process.env.GELATO_API_KEY },
  });
  if (!res.ok) return { status: null };

  const data = await res.json();
  const shipment = data.shipments?.[0];

  return {
    status: data.status || null,
    trackingNumber: shipment?.trackingCode || null,
    trackingUrl: shipment?.trackingUrl || null,
    carrier: shipment?.carrierCode || null,
  };
}

export function mapStatus(s) {
  const map = {
    created: 'processing',
    passed: 'processing',
    accepted: 'processing',
    printing: 'printing',
    printed: 'printing',
    routed: 'printing',
    shipped: 'shipped',
    delivered: 'delivered',
  };
  return map[(s || '').toLowerCase()] || null;
}

async function _sendVendorEmail(order, address, artworkUrl) {
  const vendorEmail = process.env.GELATO_VENDOR_EMAIL || process.env.VENDOR_EMAIL;
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
[Gelato Vendor Email Mock]
To: ${vendorEmail || 'gelato@example.com'}
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
    subject: `New Order (Gelato): ${order.orderNumber} — ${title}`,
    html: emailWrapper(`
      <h2 style="color: #e6c27e; margin: 0 0 4px;">New Gelato Order</h2>
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
