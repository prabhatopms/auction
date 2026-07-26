/**
 * Vercel Edge Middleware — social bot meta-tag injection
 *
 * Social crawlers (WhatsApp, Twitter, Telegram, Slack, Discord, LinkedIn,
 * iMessage link previews, etc.) do NOT execute JavaScript. A plain SPA sends
 * them an empty <body> with no meta tags, so every shared link shows a blank
 * preview. This middleware intercepts those bot requests and returns a tiny
 * pre-populated HTML page with the correct og: / twitter: tags so that link
 * previews look great. Regular users fall through unchanged to the SPA.
 */

export const config = {
  matcher: ['/', '/lots', '/lots/:lotNumber', '/sitemap.xml'],
};

const SITE = 'https://oxide.chemicalfarmers.com';

// Resolved at edge runtime from Vercel env vars
function apiBase() {
  return (
    process.env.VITE_API_URL ||
    process.env.API_URL ||
    'https://oxide-backend.up.railway.app' // fallback — override via env
  );
}

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|slack|discord|viber|imessage|iMessage|LINE|snapchat|pinterest|applebot|googlebot|bingbot|yandex|baidu|duckduckbot|sogou|exabot|semrush|ahrefs|mj12bot|dotbot/i;

function isBot(ua) {
  return BOT_RE.test(ua);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPage({ title, description, ogImage, canonicalUrl, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <link rel="canonical" href="${esc(canonicalUrl)}"/>

  <!-- Open Graph -->
  <meta property="og:site_name" content="Oxide"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${esc(canonicalUrl)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:image" content="${esc(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:image:alt" content="${esc(title)}"/>
  <meta property="og:locale" content="en_IN"/>

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(ogImage)}"/>

  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}

  <!-- Redirect real users to the SPA immediately -->
  <meta http-equiv="refresh" content="0;url=${esc(canonicalUrl)}"/>
</head>
<body>
  <p>Redirecting to <a href="${esc(canonicalUrl)}">Oxide — Live AI T-Shirt Auction</a>…</p>
</body>
</html>`;
}

function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildSitemap(api) {
  const data = await fetch(`${api}/api/lots/sitemap-list`, {
    headers: { 'User-Agent': 'Oxide-Meta-Bot/1.0' },
    signal: AbortSignal.timeout(4000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const lots = data?.lots ?? [];

  const staticUrls = [
    { loc: `${SITE}/`, changefreq: 'hourly', priority: '1.0' },
    { loc: `${SITE}/lots`, changefreq: 'daily', priority: '0.8' },
    { loc: `${SITE}/how-it-works`, changefreq: 'monthly', priority: '0.4' },
  ];

  const lotUrls = lots.map((l) => ({
    loc: `${SITE}/lots/${l.lotNumber}`,
    lastmod: l.endsAt ? new Date(l.endsAt).toISOString().slice(0, 10) : undefined,
    changefreq: 'weekly',
    priority: '0.6',
  }));

  const all = [...staticUrls, ...lotUrls];
  const body = all.map((u) => `  <url>
    <loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const api = apiBase();

  // Sitemap is regenerated on every request so new lots appear without a redeploy.
  if (url.pathname === '/sitemap.xml') {
    try {
      const xml = await buildSitemap(api);
      return new Response(xml, {
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    } catch {
      return; // fall through to the static public/sitemap.xml
    }
  }

  const ua = request.headers.get('user-agent') ?? '';
  if (!isBot(ua)) return; // pass through to SPA

  try {
    if (url.pathname === '/') {
      // Fetch the current lot for the live auction room
      const data = await fetch(`${api}/api/lots/current`, {
        headers: { 'User-Agent': 'Oxide-Meta-Bot/1.0' },
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const lot = data?.lot;
      const title = lot
        ? `Bid on "${lot.title ?? `Drop #${lot.lotNumber}`}" — Oxide Live Auction`
        : 'Oxide — Live AI T-Shirt Auction';
      const description = lot?.description
        ? `${lot.description.slice(0, 140)}… Starting at ₹${Number(lot.startingBid).toLocaleString('en-IN')}. One tee. No reprints.`
        : 'One AI-generated art tee drops every 24 hours. Bid live. Win the original. No reprints, ever.';
      const ogImage = lot
        ? `${api}/api/og/lot/${lot.id}`
        : `${SITE}/og-default.png`;

      const jsonLd = lot ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: lot.title ?? `Drop #${lot.lotNumber}`,
        description: lot.description ?? description,
        brand: { '@type': 'Brand', name: 'Oxide' },
        image: ogImage,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'INR',
          price: lot.startingBid,
          availability: lot.status === 'active'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/SoldOut',
          url: `${SITE}/`,
        },
      }) : null;

      return new Response(
        buildPage({ title, description, ogImage, canonicalUrl: `${SITE}/`, jsonLd }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      );
    }

    if (url.pathname === '/lots') {
      const title = 'Lots & Archive — Oxide';
      const description = 'Browse every Oxide drop — AI-generated art tees auctioned one per day. See sold lots, winning bids, and the live auction.';
      const ogImage = `${SITE}/og-default.png`;

      return new Response(
        buildPage({ title, description, ogImage, canonicalUrl: `${SITE}/lots`, jsonLd: null }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } },
      );
    }

    const lotMatch = url.pathname.match(/^\/lots\/(\d+)$/);
    if (lotMatch) {
      const lotNumber = lotMatch[1];
      const data = await fetch(`${api}/api/lots/by-number/${lotNumber}`, {
        headers: { 'User-Agent': 'Oxide-Meta-Bot/1.0' },
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const lot = data?.lot;
      const canonicalUrl = `${SITE}/lots/${lotNumber}`;
      if (!lot) {
        return new Response(
          buildPage({
            title: 'Lot not found — Oxide',
            description: 'This drop doesn\'t exist, or hasn\'t happened yet.',
            ogImage: `${SITE}/og-default.png`,
            canonicalUrl,
            jsonLd: null,
          }),
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
        );
      }

      const lotTitle = lot.title ?? `Drop #${lot.lotNumber}`;
      const isSold = lot.paymentStatus === 'paid';
      const title = `"${lotTitle}" — Oxide Drop #${lot.lotNumber}`;
      const description = lot.description
        ? `${lot.description.slice(0, 150)}… ${isSold ? `Sold for ₹${Number(lot.soldPrice ?? 0).toLocaleString('en-IN')}.` : 'Reserve not met.'} One tee, never reprinted.`
        : `"${lotTitle}" — a one-of-one AI-generated art tee from Oxide, Drop #${lot.lotNumber}.`;
      const ogImage = `${api}/api/og/lot/${lot.id}`;

      const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: lotTitle,
        description: lot.description ?? description,
        brand: { '@type': 'Brand', name: 'Oxide' },
        image: ogImage,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'INR',
          price: isSold ? lot.soldPrice : lot.startingBid,
          availability: isSold ? 'https://schema.org/SoldOut' : 'https://schema.org/Discontinued',
          url: canonicalUrl,
        },
      });

      return new Response(
        buildPage({ title, description, ogImage, canonicalUrl, jsonLd }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' } },
      );
    }
  } catch {
    // On any error, fall through to the SPA — never break the user experience
  }
}
