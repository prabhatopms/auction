/* Shared parsing/formatting for the generated artworkHeadline JSON blob.
   Used by both PeekModal and LotDetail so the two stay in sync. */

export function parseArtworkMeta(artworkHeadline) {
  if (!artworkHeadline || !artworkHeadline.startsWith('{')) {
    return { isJson: false, title: null, signalsUsed: [], interpretiveStatement: '' };
  }
  try {
    const parsed = JSON.parse(artworkHeadline);
    return {
      isJson: true,
      title: parsed.title || null,
      signalsUsed: parsed.data_signals_used || [],
      interpretiveStatement: parsed.interpretive_statement || '',
    };
  } catch {
    return { isJson: false, title: null, signalsUsed: [], interpretiveStatement: '' };
  }
}

/* Strips the raw category/source prefix off a signal string and returns
   { text, source } — e.g. "Weird News: A goat..." -> { text: 'A goat...', source: 'UPI Weird News' } */
export function formatSignalWithSource(sig) {
  if (!sig) return { text: '', source: '' };

  let text = sig.trim();
  let source = '';
  const orig = text.toLowerCase();

  if (orig.includes('weird news') || orig.includes('upi_weird_news') || orig.includes('weird') || orig.includes('watch:')) {
    source = 'UPI Weird News';
  } else if (orig.includes('oddity_central') || orig.includes('oddity')) {
    source = 'Oddity Central';
  } else if (orig.includes('global attention') || orig.includes('collective attention') || orig.includes('top_wikipedia') || orig.includes('top wikipedia') || orig.includes('pageviews') || orig.includes('wikipedia top search') || orig.includes('daily news') || orig.includes('daily_news') || (orig.includes('wikipedia') && !orig.includes('day') && !orig.includes('event'))) {
    source = 'Wikipedia Top Search';
  } else if (orig.includes('optimist_daily') || orig.includes('optimist')) {
    source = 'Optimist Daily';
  } else if (orig.includes('positive_news') || orig.includes('positive news') || orig.includes('good news') || orig.includes('gnn')) {
    source = 'Good News Network';
  } else if (orig.includes('future prediction') || orig.includes('polymarket') || orig.includes('prediction') || orig.includes('probability') || orig.includes('percent probability') || orig.includes('% probability')) {
    source = 'Polymarket Trending';
  } else if (orig.includes('cultural resonance') || orig.includes('top_song') || orig.includes('top song') || orig.includes('song') || orig.includes('spotify') || orig.includes('apple music')) {
    source = 'Top Song';
  } else if (orig.includes('historical lens') || orig.includes('wikipedia_on_this_day') || orig.includes('wikipedia event') || orig.includes('historical') || orig.includes('history') || orig.includes('wikipedia on this day') || orig.includes('day') || orig.match(/^\d{3,4}:/)) {
    source = 'Wikipedia On this Day';
  } else if (orig.includes('google_news') || orig.includes('google news')) {
    source = 'Google News';
  }

  const categoryPatterns = [
    /^(weird\s*news|upi_weird_news|oddity_central):\s*/i,
    /^(global\s*attention|top_wikipedia|collective\s*attention):\s*/i,
    /^(positive\s*news|optimist_daily):\s*/i,
    /^(future\s*prediction|polymarket):\s*/i,
    /^(cultural\s*resonance|top_song|song):\s*/i,
    /^(historical\s*lens|wikipedia_on_this_day|wikipedia\s*event):\s*/i,
    /^(google_news|google\s*news):\s*/i,
  ];

  const sourcePatterns = [
    { pat: /^watch:\s*/i, src: 'UPI Weird News' },
    { pat: /^upi\s*weird\s*news:\s*/i, src: 'UPI Weird News' },
    { pat: /^top\s*wikipedia:\s*/i, src: 'Wikipedia Top Search' },
    { pat: /^wikipedia\s*top\s*search:\s*/i, src: 'Wikipedia Top Search' },
    { pat: /^wikipedia\s*on\s*this\s*day:\s*/i, src: 'Wikipedia On this Day' },
    { pat: /^optimist\s*daily:\s*/i, src: 'Optimist Daily' },
    { pat: /^positive\s*news:\s*/i, src: 'Good News Network' },
    { pat: /^good\s*news\s*network:\s*/i, src: 'Good News Network' },
    { pat: /^polymarket:\s*/i, src: 'Polymarket Trending' },
    { pat: /^polymarket\s*trending:\s*/i, src: 'Polymarket Trending' },
    { pat: /^top\s*song:\s*/i, src: 'Top Song' },
    { pat: /^oddity\s*central:\s*/i, src: 'Oddity Central' },
    { pat: /^google\s*news:\s*/i, src: 'Google News' },
  ];

  let cleaned = true;
  while (cleaned) {
    cleaned = false;
    for (const pat of categoryPatterns) {
      if (pat.test(text)) { text = text.replace(pat, ''); cleaned = true; break; }
    }
    for (const item of sourcePatterns) {
      if (item.pat.test(text)) {
        if (!source) source = item.src;
        text = text.replace(item.pat, '');
        cleaned = true;
        break;
      }
    }
  }

  if (!source) source = 'Wikipedia Top Search';
  if (text.length > 0) text = text.charAt(0).toUpperCase() + text.slice(1);

  return { text, source };
}
