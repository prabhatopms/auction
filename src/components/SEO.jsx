import { Helmet } from 'react-helmet-async';

const SITE = 'https://oxide.chemicalfarmers.com';
const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Drop-in SEO component. Pass `lot` (from /api/lots/current or /api/lots/:id)
 * to get dynamic per-lot meta tags and OG images.
 */
export default function SEO({ lot, page = 'home' }) {
  if (page === 'how-it-works') {
    return (
      <Helmet>
        <title>How it Works — Oxide</title>
        <meta name="description" content="Learn how the Oxide daily AI art auction works. Understand the bid raise logic, the 18-hour auction timer, the 2-hour payment window, and autonomous daily generation." />
        <link rel="canonical" href={`${SITE}/how-it-works`} />
        <meta property="og:url" content={`${SITE}/how-it-works`} />
        <meta property="og:title" content="How it Works — Oxide" />
        <meta property="og:description" content="Learn how the Oxide daily AI art auction works. Understand the bid raise logic, the 18-hour auction timer, the 2-hour payment window, and autonomous daily generation." />
        <meta property="og:image" content={`${SITE}/og-default.png`} />
      </Helmet>
    );
  }

  if (page === 'lots') {
    return (
      <Helmet>
        <title>Lots &amp; Archive — Oxide</title>
        <meta name="description" content="Browse every Oxide drop — AI-generated art tees auctioned one per day. See sold lots, winning bids, and the live auction." />
        <link rel="canonical" href={`${SITE}/lots`} />
        <meta property="og:url" content={`${SITE}/lots`} />
        <meta property="og:title" content="Lots &amp; Archive — Oxide" />
        <meta property="og:description" content="Browse every Oxide drop — AI-generated art tees auctioned one per day." />
        <meta property="og:image" content={`${SITE}/og-default.png`} />
        <meta name="twitter:title" content="Lots &amp; Archive — Oxide" />
        <meta name="twitter:description" content="Browse every Oxide drop — AI-generated art tees auctioned one per day." />
        <meta name="twitter:image" content={`${SITE}/og-default.png`} />
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Oxide Lots & Archive',
          url: `${SITE}/lots`,
          description: 'Complete archive of all Oxide AI-generated art tee auctions.',
        })}</script>
      </Helmet>
    );
  }

  if (page === 'lot-detail' && lot) {
    const lotTitle = lot.title ?? `Drop #${lot.lotNumber}`;
    const isSold = lot.paymentStatus === 'paid';
    const soldPrice = lot.soldPrice ?? null;
    const canonicalUrl = `${SITE}/lots/${lot.lotNumber}`;
    const ogImageUrl = `${API}/api/og/lot/${lot.id}`;

    const title = `"${lotTitle}" — Oxide Drop #${lot.lotNumber}`;
    const desc = lot.description
      ? `${lot.description.slice(0, 150)}${lot.description.length > 150 ? '…' : ''} ${isSold ? `Sold for ₹${Number(soldPrice ?? 0).toLocaleString('en-IN')}.` : 'Reserve not met.'} One tee, never reprinted.`
      : `"${lotTitle}" — a one-of-one AI-generated art tee from Oxide, Drop #${lot.lotNumber}.`;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: lotTitle,
      description: lot.description ?? desc,
      sku: `OXIDE-${lot.lotNumber}`,
      brand: { '@type': 'Brand', name: 'Oxide' },
      image: ogImageUrl,
      offers: {
        '@type': 'Offer',
        priceCurrency: 'INR',
        price: isSold ? soldPrice : lot.startingBid,
        availability: isSold ? 'https://schema.org/SoldOut' : 'https://schema.org/Discontinued',
        url: canonicalUrl,
      },
    };

    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Oxide', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Lots & Archive', item: `${SITE}/lots` },
        { '@type': 'ListItem', position: 3, name: lotTitle, item: canonicalUrl },
      ],
    };

    return (
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonicalUrl} />

        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`${lotTitle} — Oxide`} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
        <meta name="twitter:image" content={ogImageUrl} />

        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
      </Helmet>
    );
  }

  if (!lot) {
    return (
      <Helmet>
        <title>Oxide — Live AI T-Shirt Auction</title>
        <meta name="description" content="Oxide drops one AI-generated art tee every 24 hours. Bid live, win the original. Limited edition. No reprints." />
        <link rel="canonical" href={SITE} />
      </Helmet>
    );
  }

  const lotTitle = lot.title ?? `Drop #${lot.lotNumber}`;
  const artist = lot.artist ?? 'Oxide';
  const startingBid = lot.startingBid ?? 1;
  const isActive = lot.status === 'active';
  const isClosed = lot.status === 'closed';

  const title = isActive
    ? `Bid on "${lotTitle}" — Drop #${lot.lotNumber} | Oxide Live Auction`
    : `"${lotTitle}" — Oxide Drop #${lot.lotNumber}`;

  const desc = lot.description
    ? `${lot.description.slice(0, 140)}… Bid from ₹${startingBid.toLocaleString('en-IN')}. One tee. No reprints.`
    : `AI-generated art tee by ${artist}. One drop per day. Bid from ₹${startingBid.toLocaleString('en-IN')}.`;

  const ogImageUrl = `${API}/api/og/lot/${lot.id}`;
  const canonicalUrl = `${SITE}/`;

  const jsonLd = isActive ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: lotTitle,
    description: lot.description ?? desc,
    brand: { '@type': 'Brand', name: 'Oxide' },
    image: ogImageUrl,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: startingBid,
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
      seller: { '@type': 'Organization', name: 'Oxide' },
    },
  } : isClosed ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: lotTitle,
    description: lot.description ?? desc,
    brand: { '@type': 'Brand', name: 'Oxide' },
    image: ogImageUrl,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: lot.soldPrice ?? startingBid,
      availability: 'https://schema.org/SoldOut',
      url: canonicalUrl,
    },
  } : null;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonicalUrl} />

      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={ogImageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${lotTitle} — Oxide`} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={ogImageUrl} />

      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  );
}
