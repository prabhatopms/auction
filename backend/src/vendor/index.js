import { prisma } from '../prisma.js';
import * as qikinkVendor from './qikink.js';
import * as printfulVendor from './printful.js';
import * as gelatoVendor from './gelato.js';

const US_CA = ['US', 'CA'];

// Qikink's existing module exposes notifyVendor/pollQikinkOrders rather than the
// uniform placeOrder/getOrderStatus/mapStatus interface. Adapt it here so the
// router can treat every provider identically.
const QIKINK_STATUS_MAP = {
  confirmed: 'processing',
  printing: 'printing',
  printed: 'printing',
  shipped: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
};

const qikinkAdapter = {
  async placeOrder(order, address, _artworkUrl) {
    let lot = null;
    try {
      lot = await prisma.lot.findUnique({ where: { id: order.lotId } });
    } catch { /* best-effort */ }
    const vendorOrderId = await qikinkVendor.notifyVendor(order, lot, address);
    return { vendorOrderId: vendorOrderId || null };
  },
  async getOrderStatus(_vendorOrderId) {
    // Qikink status polling is handled by its own pollQikinkOrders routine; this
    // adapter is a no-op so the uniform poller does not double-process it.
    return { status: null };
  },
  mapStatus(s) {
    const raw = (s || '').toLowerCase().replace(/\s+/g, '_');
    return QIKINK_STATUS_MAP[raw] || null;
  },
};

function getVendor(countryCode) {
  const cc = (countryCode || 'IN').toUpperCase();
  if (cc === 'IN') return { vendor: qikinkAdapter, provider: 'qikink' };
  if (US_CA.includes(cc)) return { vendor: printfulVendor, provider: 'printful' };
  return { vendor: gelatoVendor, provider: 'gelato' };
}

export async function routeVendorOrder(order, address, artworkUrl) {
  const { vendor, provider } = getVendor(address.country || 'IN');
  const result = await vendor.placeOrder(order, address, artworkUrl);
  return { ...result, vendorProvider: provider };
}

const PROVIDERS = {
  qikink: qikinkAdapter,
  printful: printfulVendor,
  gelato: gelatoVendor,
};

export async function pollAllVendorOrders() {
  let orders;
  try {
    orders = await prisma.order.findMany({
      where: {
        status: { notIn: ['delivered', 'cancelled'] },
        vendorOrderId: { not: null },
      },
      include: {
        lot: true,
        address: true,
        user: { select: { email: true, name: true } },
      },
    });
  } catch (e) {
    console.error('[Vendor] pollAllVendorOrders: failed to fetch orders:', e.message);
    return;
  }

  for (const order of orders) {
    try {
      const provider = order.vendorProvider || 'qikink';
      const vendor = PROVIDERS[provider];
      if (!vendor) continue;

      const { status: rawStatus, trackingNumber, trackingUrl, carrier } = await vendor.getOrderStatus(order.vendorOrderId);
      if (!rawStatus) continue;

      const mapped = vendor.mapStatus(rawStatus);
      if (!mapped || mapped === order.status) continue;

      const now = new Date();
      const update = { status: mapped };
      if (mapped === 'printing' && !order.printedAt) update.printedAt = now;
      if (mapped === 'shipped' && !order.shippedAt) {
        update.shippedAt = now;
        if (carrier) update.carrier = carrier;
        if (trackingNumber) update.trackingNumber = trackingNumber;
        if (trackingUrl) update.trackingUrl = trackingUrl;
      }
      if (mapped === 'delivered' && !order.deliveredAt) update.deliveredAt = now;

      await prisma.order.update({ where: { id: order.id }, data: update });
      console.log(`[Vendor] Order ${order.orderNumber} (${provider}) status: ${order.status} → ${mapped}`);
    } catch (e) {
      console.error(`[Vendor] pollAllVendorOrders failed for order ${order.orderNumber}:`, e.message);
    }
  }
}
