import { Router } from 'express';
import geoip from 'geoip-lite';
import { prisma } from '../prisma.js';

const router = Router();

export const CURRENCIES = [
  { currency: 'INR', symbol: '₹', locale: 'en-IN', label: 'India', flag: '🇮🇳' },
  { currency: 'USD', symbol: '$', locale: 'en-US', label: 'United States', flag: '🇺🇸' },
  { currency: 'GBP', symbol: '£', locale: 'en-GB', label: 'United Kingdom', flag: '🇬🇧' },
  { currency: 'EUR', symbol: '€', locale: 'de-DE', label: 'Europe', flag: '🇪🇺' },
];

const EUR_COUNTRIES = ['DE', 'FR', 'ES', 'NL', 'IT', 'BE', 'AT', 'PT', 'GR', 'CZ', 'RO', 'HU', 'PL', 'SE', 'DK', 'FI', 'NO', 'CH'];

const COUNTRY_CURRENCY = { IN: 'INR', US: 'USD', CA: 'USD', GB: 'GBP' };
for (const c of EUR_COUNTRIES) COUNTRY_CURRENCY[c] = 'EUR';

function currencyMeta(currency) {
  return CURRENCIES.find((c) => c.currency === currency) || CURRENCIES[0];
}

/* GET /api/geo — detect country + currency from request IP */
router.get('/geo', (req, res) => {
  let ip = '';
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) ip = String(fwd).split(',')[0].trim();
  else ip = req.socket?.remoteAddress || '';

  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  if (!ip || ip === '127.0.0.1' || ip === '::1') {
    return res.json({ country: 'IN', currency: 'INR', symbol: '₹', locale: 'en-IN' });
  }

  const geo = geoip.lookup(ip);
  const country = geo?.country || 'IN';
  const currency = COUNTRY_CURRENCY[country] || 'INR';
  const { symbol, locale } = currencyMeta(currency);
  res.json({ country, currency, symbol, locale });
});

/* GET /api/currencies — list of supported currencies */
router.get('/currencies', (_req, res) => {
  res.json({ currencies: CURRENCIES });
});

/* GET /api/product-prices — all product prices (public, for frontend context) */
router.get('/product-prices', async (_req, res) => {
  try {
    const prices = await prisma.productPrice.findMany({ orderBy: [{ productType: 'asc' }, { currency: 'asc' }] });
    res.json({ prices });
  } catch (err) {
    console.error('[Pricing] product-prices error:', err);
    res.status(500).json({ error: 'Failed to fetch product prices' });
  }
});

/* GET /api/admin/product-prices — same, under admin namespace */
router.get('/admin/product-prices', async (_req, res) => {
  try {
    const prices = await prisma.productPrice.findMany({ orderBy: [{ productType: 'asc' }, { currency: 'asc' }] });
    res.json({ prices });
  } catch (err) {
    console.error('[Pricing] admin product-prices error:', err);
    res.status(500).json({ error: 'Failed to fetch product prices' });
  }
});

/* PUT /api/admin/product-prices/:productType — upsert all currency prices for a product type */
router.put('/admin/product-prices/:productType', async (req, res) => {
  try {
    const { productType } = req.params;
    const { prices } = req.body;
    if (!Array.isArray(prices)) return res.status(400).json({ error: 'prices array required' });

    const updated = [];
    for (const { currency, startingBid, minIncrement } of prices) {
      const record = await prisma.productPrice.upsert({
        where: { productType_currency: { productType, currency } },
        create: { productType, currency, startingBid, minIncrement },
        update: { startingBid, minIncrement },
      });
      updated.push(record);
    }

    res.json({ success: true, prices: updated });
  } catch (err) {
    console.error('[Pricing] admin update error:', err);
    res.status(500).json({ error: 'Failed to update product prices' });
  }
});

export default router;
