export const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

export function getArtworkUrl(lot, apiBaseUrl = '') {
  if (!lot) return null;

  // Cache-bust value: use swappedAt timestamp if present, otherwise fall back to "2"
  const v = lot._artworkSwappedAt ?? 2;

  const raw = lot.artworkUrl;
  if (raw && raw !== 'null' && raw !== 'undefined') {
    // GCS URL — proxy through backend to avoid CORS/403
    if (/^https?:\/\/storage\.googleapis\.com\//.test(raw)) {
      const filename = raw.split('/').pop();
      if (filename) return `${apiBaseUrl}/api/artwork/${filename}?v=${v}`;
    }
    // Already an external URL (CDN) — use directly
    if (/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(raw)) return raw;
    // Already a proxied /api/artwork/ path
    if (raw.includes('/api/artwork/')) {
      const base = raw.startsWith('http') ? raw : `${apiBaseUrl}${raw}`;
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}v=${v}`;
    }
    // Local path — extract filename and proxy
    const filename = raw.split('/').pop();
    if (filename) return `${apiBaseUrl}/api/artwork/${filename}?v=${v}`;
  }

  // Derive from lot number / lotNo (no artwork set yet)
  let num = null;
  if (lot.lotNumber != null) {
    num = parseInt(lot.lotNumber, 10);
  } else if (lot.lotNo != null) {
    const match = String(lot.lotNo).match(/\d+/);
    if (match) num = parseInt(match[0], 10);
  }

  if (num != null && !isNaN(num)) return `${apiBaseUrl}/api/artwork/lot-${num}.png`;

  return null;
}

/* deterministic PRNG so the archive is stable across reloads */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* per-lot generative bloom — three hue-shifted radial fields inside the tee silhouette */
export function bloomFor(lot) {
  const h = lot.hue;
  const a = h, b = (h + 38) % 360, c = (h + 312) % 360;
  const s = lot.seed;
  const j = (n) => ((s * (n + 7)) % 18) - 9;
  return [
    `radial-gradient(58% 50% at ${50 + j(1)}% ${36 + j(2)}%, hsl(${a} 72% 62% / 0.58), transparent 60%)`,
    `radial-gradient(52% 46% at ${62 + j(3)}% ${60 + j(4)}%, hsl(${b} 78% 60% / 0.5), transparent 60%)`,
    `radial-gradient(54% 50% at ${38 + j(5)}% ${64 + j(6)}%, hsl(${c} 64% 54% / 0.46), transparent 62%)`,
    '#16131f',
  ].join(', ');
}

const WORDS = [
  'Drift', 'Bloom', 'Cascade', 'Null Garden', 'Slow Static', 'Aurora Wake',
  'Halftone Sea', 'Soft Machine', 'Ember Index', 'Glass Meadow', 'Neon Fossil',
  'Quiet Storm', 'Latent Hour', 'Paper Moon', 'Dust & Signal', 'Velvet Noise',
  'Tideline', 'Afterimage', 'Mirror Bloom', 'Cobalt Drift', 'Ghost Orchid',
  'Salt Print', 'Low Tide', 'Undertow', 'Bright Decay', 'Snowmelt',
  'Carbon Bloom', 'Field Notes', 'Phantom Limb', 'Wax & Wane', 'Long Exposure',
  'Static Bloom', 'Pale Engine', 'Night Swim', 'Open Cluster', 'Soft Eclipse',
  'Iron Petal', 'Blue Hour', 'Residue', 'Thaw', 'Signal Garden', 'Deep Field',
];

const WINNERS = [
  { name: 'Vela K.', hue: 268 }, { name: 'Nori', hue: 32 }, { name: 'astra_09', hue: 200 },
  { name: 'M. Reyes', hue: 150 }, { name: 'k060x', hue: 320 }, { name: 'Juno', hue: 48 },
  { name: 'Sable', hue: 12 }, { name: 'Wren', hue: 95 }, { name: 'Okafor', hue: 220 },
  { name: 'Lin', hue: 290 }, { name: 'Decker', hue: 60 }, { name: 'Yara', hue: 175 },
];

const SIZES = ['Small', 'Medium', 'Large'];

const COTTON = [
  'printed on organic heavyweight cotton',
  'printed on brushed jersey, 240 gsm',
  'printed on raw selvedge canvas tee',
  'printed on stonewashed heavy cotton',
];

const DESC = [
  'A one-off wearable artwork — a latent-space bloom, screen-printed in seven passes. Includes a signed provenance token.',
  'Generated from a single seed and never reproduced. Hand-finished, with a woven authentication label at the nape.',
  'A frozen frame from a continuous diffusion run, committed to fabric. Sold with its on-chain certificate.',
  'Drawn from Oxide Atelier\'s nightly model. The only print of its kind — pigment fused, pre-washed, archival.',
  'An emergent pattern caught mid-collapse and pressed into cloth. Ships with provenance card and care kit.',
];

/* the live lot (mirrors the live auction stage) */
export const LIVE_LOT = {
  id: 'lot-014',
  lotNo: '014',
  title: 'Untitled (Drift No. 7)',
  artist: 'Oxide Atelier · printed on organic heavyweight cotton',
  desc: 'A one-off wearable artwork — a latent-space bloom, screen-printed in seven passes. Includes a signed provenance token.',
  size: 'Medium',
  status: 'live',
  startingBid: 120,
  hue: 268,
  seed: 47,
  shots: 4,
  watching: 214,
};

/* generate the archive of past, closed lots */
export function buildArchive() {
  const lots = [];
  const total = 41;
  for (let i = 0; i < total; i++) {
    const seed = 1000 + i * 37;
    const r = rng(seed);
    const lotNum = 13 - i;
    const lotNo = lotNum > 0
      ? String(lotNum).padStart(3, '0')
      : 'S1·' + String(20 + lotNum).padStart(2, '0');
    const word = WORDS[i % WORDS.length];
    const passed = r() < 0.1;
    const startingBid = 80 + Math.floor(r() * 6) * 20;
    const bids = passed ? Math.floor(r() * 4) + 1 : Math.floor(r() * 46) + 8;
    const soldPrice = passed ? 0 : startingBid + Math.floor(bids * (18 + r() * 60)) + Math.floor(r() * 200);
    const winner = WINNERS[Math.floor(r() * WINNERS.length)];
    lots.push({
      id: 'lot-' + lotNo.replace(/[^a-z0-9]/gi, ''),
      lotNo,
      title: 'Untitled (' + word + ' No. ' + (((seed >> 3) % 9) + 1) + ')',
      artist: 'Oxide Atelier · ' + COTTON[Math.floor(r() * COTTON.length)],
      desc: DESC[Math.floor(r() * DESC.length)],
      size: SIZES[Math.floor(r() * SIZES.length)],
      status: passed ? 'unsold' : 'sold',
      startingBid,
      soldPrice,
      bids,
      winner: passed ? null : { name: winner.name, hue: winner.hue },
      hue: Math.floor(r() * 360),
      seed,
      shots: 3 + Math.floor(r() * 2),
      owned: false,
    });
  }

  /* mark a few as owned by the logged-in user, at different delivery stages */
  const carriers = ['DHL Express', 'FedEx Priority', 'UPS Worldwide'];
  const ADDR = 'Apt 7B · 114 Wythe Ave, Brooklyn, NY 11249';
  const owners = [
    { idx: 1, stage: 3, days: 14 },
    { idx: 4, stage: 2, days: 4 },
    { idx: 9, stage: 1, days: 1 },
  ];
  owners.forEach((o, k) => {
    const lot = lots[o.idx];
    if (!lot) return;
    lot.owned = true;
    lot.winner = { name: 'You', hue: 45 };
    lot.soldPrice = lot.soldPrice || (lot.startingBid + 300);
    if (lot.status === 'unsold') { lot.status = 'sold'; lot.bids = Math.max(lot.bids, 12); }
    lot.delivery = {
      stage: o.stage,
      paidOn: daysAgo(o.days + 9),
      printedOn: o.stage >= 1 ? daysAgo(o.days + 6) : null,
      shippedOn: o.stage >= 2 ? daysAgo(o.days + 3) : null,
      deliveredOn: o.stage >= 3 ? daysAgo(o.days - 1) : null,
      eta: o.stage >= 3 ? null : daysAgo(-(2 + k)),
      carrier: carriers[k % carriers.length],
      tracking: 'OX' + (7400000 + o.idx * 311 + k * 17) + 'US',
      address: ADDR,
    };
  });

  return lots;
}

function daysAgo(d) {
  const dt = new Date(Date.now() - d * 86400000);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const TRACK_STEPS = [
  { key: 'paid', lab: 'Payment cleared', field: 'paidOn' },
  { key: 'printing', lab: 'In the atelier · printing', field: 'printedOn' },
  { key: 'shipped', lab: 'Shipped', field: 'shippedOn' },
  { key: 'delivered', lab: 'Delivered', field: 'deliveredOn' },
];
