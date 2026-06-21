import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';

const __dir = dirname(fileURLToPath(import.meta.url));
const IG_API = 'https://graph.instagram.com/v25.0';

// Fetch and cache Roboto Regular + Bold as base64 so the SVG renderer never
// needs system fonts (fontconfig is unreliable in Nix/Railway containers).
let _fonts = null;
async function getFonts() {
  if (_fonts) return _fonts;
  const fetch64 = async (urls) => {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        return Buffer.from(await res.arrayBuffer()).toString('base64');
      } catch (_) {}
    }
    return null;
  };
  const [regular, bold] = await Promise.all([
    fetch64(['https://cdn.jsdelivr.net/npm/roboto-fontface@0.10.0/fonts/roboto/Roboto-Regular.woff2']),
    fetch64(['https://cdn.jsdelivr.net/npm/roboto-fontface@0.10.0/fonts/roboto/Roboto-Bold.woff2']),
  ]);
  if (regular) console.log('[Instagram] Roboto fonts loaded for SVG embedding.');
  else console.warn('[Instagram] Could not fetch Roboto — SVG text may render as boxes on Linux.');
  _fonts = { regular, bold };
  return _fonts;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapText(text, maxChars) {
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseSignal(sig) {
  const sourcePatterns = [
    { pat: /^UPI Weird News:\s*/i, src: 'UPI Weird News' },
    { pat: /^Oddity Central:\s*/i, src: 'Oddity Central' },
    { pat: /^Wikipedia Top Search:\s*/i, src: 'Wikipedia Top Search' },
    { pat: /^Wikipedia On this Day:\s*/i, src: 'Wikipedia On this Day' },
    { pat: /^Good News Network:\s*/i, src: 'Good News Network' },
    { pat: /^Optimist Daily:\s*/i, src: 'Optimist Daily' },
    { pat: /^Polymarket Trending:\s*/i, src: 'Polymarket Trending' },
    { pat: /^Top Song:\s*/i, src: 'Top Song' },
    { pat: /^Google News:\s*/i, src: 'Google News' },
  ];

  let text = String(sig).trim();
  let source = '';

  for (const { pat, src } of sourcePatterns) {
    if (pat.test(text)) {
      source = src;
      text = text.replace(pat, '');
      break;
    }
  }

  if (text.length > 0) text = text.charAt(0).toUpperCase() + text.slice(1);
  return { text, source };
}

// ─── Image creation ───────────────────────────────────────────────────────────

function buildTextCardSvg(headline, fonts = {}) {
  const W = 1080, H = 1080;
  const MARGIN = 80;
  const GOLD = '#c9a84c';
  const FONT_R = fonts.regular ? 'CardFont' : 'Arial,sans-serif';
  const FONT_B = fonts.bold ? 'CardFontBold' : FONT_R;

  const title = headline.title || 'Untitled';
  const signals = (headline.data_signals_used || headline.data_signals_used_summarized || []).slice(0, 5);

  // ── @font-face defs ──
  const fontStyles = [
    fonts.regular ? `@font-face{font-family:'CardFont';font-weight:400;src:url('data:font/woff2;base64,${fonts.regular}');}` : '',
    fonts.bold    ? `@font-face{font-family:'CardFontBold';font-weight:700;src:url('data:font/woff2;base64,${fonts.bold}');}` : '',
  ].join('');
  const defs = fontStyles
    ? `<defs><style>${fontStyles}</style></defs>`
    : '';

  // ── helper: render a signal row, returns nodes and height consumed ──
  function signalNodes(signal, startY) {
    const { text: sigText, source } = parseSignal(signal);
    const full = source ? `${sigText} [${source}]` : sigText;
    const lines = wrapText(full, 50).slice(0, 2);
    const out = [];
    let cy = startY;

    // gold bullet
    out.push(`<text x="${MARGIN}" y="${cy}" font-family="${FONT_R}" font-size="22" fill="${GOLD}">—</text>`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasSource = source && line.includes(`[${source}]`);
      if (hasSource) {
        const idx = line.lastIndexOf(`[${source}]`);
        const before = line.slice(0, idx);
        out.push(`<text x="${MARGIN + 28}" y="${cy}" font-family="${FONT_R}" font-size="26" fill="#b0b0b0">${escapeXml(before)}<tspan fill="#555555" font-style="italic">[${escapeXml(source)}]</tspan></text>`);
      } else {
        out.push(`<text x="${MARGIN + 28}" y="${cy}" font-family="${FONT_R}" font-size="26" fill="#b0b0b0">${escapeXml(line)}</text>`);
      }
      cy += 36;
    }
    cy += 10; // gap between signals
    return { nodes: out, height: cy - startY };
  }

  // ── corner bracket helper ──
  function corner(x, y, dx, dy) {
    const L = 52, T = 2;
    return [
      `<rect x="${x}" y="${y}" width="${dx * L}" height="${T}" fill="${GOLD}"/>`,
      `<rect x="${x + (dx < 0 ? dx * L : 0)}" y="${y}" width="${T}" height="${dy * L}" fill="${GOLD}"/>`,
    ];
  }

  // ── pre-compute signal block height ──
  let signalBlockH = 0;
  const tempSignalNodes = [];
  for (const sig of signals) {
    const r = signalNodes(sig, 0);
    signalBlockH += r.height;
    tempSignalNodes.push(r);
  }

  // ── vertical layout: center the content block ──
  const TITLE_LINES = wrapText(title.toUpperCase(), 14).slice(0, 3);
  const titleH = TITLE_LINES.length * 110;
  const headerH = 80;  // gold line + gap
  const labelH = 56;   // "TODAY'S SIGNALS" + gap
  const contentH = headerH + titleH + 24 + labelH + signalBlockH;
  const startY = Math.max(80, Math.floor((H - contentH) / 2));

  const nodes = [];

  // ── corner brackets ──
  nodes.push(...corner(MARGIN - 2, MARGIN - 2, 1, 1));
  nodes.push(...corner(W - MARGIN + 2, MARGIN - 2, -1, 1));
  nodes.push(...corner(MARGIN - 2, H - MARGIN + 2, 1, -1));
  nodes.push(...corner(W - MARGIN + 2, H - MARGIN + 2, -1, -1));

  let y = startY;

  // ── top gold accent line ──
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${W - MARGIN}" y2="${y}" stroke="${GOLD}" stroke-width="1" opacity="0.5"/>`);
  y += 44;

  // ── title ──
  for (const line of TITLE_LINES) {
    nodes.push(`<text x="${MARGIN}" y="${y}" font-family="${FONT_B}" font-size="104" fill="#FFFFFF" letter-spacing="-2">${escapeXml(line)}</text>`);
    y += 110;
  }
  y += 10;

  // ── thin gold rule under title ──
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + 160}" y2="${y}" stroke="${GOLD}" stroke-width="2"/>`);
  y += 40;

  // ── "TODAY'S SIGNALS" label ──
  nodes.push(`<text x="${MARGIN}" y="${y}" font-family="${FONT_R}" font-size="16" fill="${GOLD}" letter-spacing="6">TODAY'S SIGNALS</text>`);
  y += 16;
  // thin full-width rule under label
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${W - MARGIN}" y2="${y}" stroke="#222222" stroke-width="1"/>`);
  y += 30;

  // ── signals ──
  for (const sig of signals) {
    const r = signalNodes(sig, y);
    nodes.push(...r.nodes);
    y += r.height;
  }

  // ── bottom gold accent line ──
  y = H - MARGIN + 2 - 54;
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${W - MARGIN}" y2="${y}" stroke="${GOLD}" stroke-width="1" opacity="0.5"/>`);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="${W}" height="${H}" fill="#080808"/>
  ${nodes.join('\n  ')}
</svg>`;
}

async function createTextCardBuffer(headline) {
  if (!process.env.FONTCONFIG_FILE) {
    process.env.FONTCONFIG_FILE = join(__dir, 'fonts.conf');
  }
  const fonts = await getFonts();
  const svg = buildTextCardSvg(headline, fonts);
  return await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

/**
 * Fetch the artwork and resize it to 1080x1080 (contain, black background).
 */
async function resizeArtworkForInstagram(artworkUrl) {
  let imageBuffer;
  if (artworkUrl.startsWith('http')) {
    const res = await fetch(artworkUrl);
    if (!res.ok) throw new Error(`Artwork fetch failed: ${res.status} ${artworkUrl}`);
    imageBuffer = Buffer.from(await res.arrayBuffer());
  } else {
    // Local path like /public/artwork/lot-N.png
    const localPath = join(__dir, '../public', artworkUrl.replace('/public/', ''));
    imageBuffer = await fs.readFile(localPath);
  }

  // Instagram requires JPEG — resize and convert
  return await sharp(imageBuffer)
    .resize(1080, 1080, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ─── GCS upload ──────────────────────────────────────────────────────────────

async function uploadBufferToGCS(buffer, filename) {
  if (!process.env.GCS_BUCKET_NAME) throw new Error('GCS_BUCKET_NAME not configured');

  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
  const destination = `instagram/${filename}`;
  const file = bucket.file(destination);

  await file.save(buffer, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=86400' },
  });

  const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destination}`;
  try {
    await file.makePublic();
  } catch {
    const check = await fetch(gcsUrl, { method: 'HEAD' });
    if (!check.ok) throw new Error(`GCS object not publicly accessible: ${gcsUrl}`);
  }
  return gcsUrl;
}

// ─── Caption generation ───────────────────────────────────────────────────────

async function generateCaption(lot, headline) {
  const signals = (headline.data_signals_used_summarized || []).join(', ');

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) {
    try {
      const ai = process.env.GEMINI_API_KEY
        ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
        : new GoogleGenAI({
            vertexai: true,
            project: process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
          });

      const prompt = `You are the social media manager for Oxide Atelier, a daily AI art auction. Write an Instagram caption for today's artwork.

Artwork:
- Title: "${headline.title}"
- Essence: "${headline.essence}"
- Inspiration signals: ${signals}
- Concept: "${headline.interpretive_statement}"
- Lot #${lot.lotNumber}, 18-hour auction, starting bid ₹${lot.startingBid}
- Bid URL: oxide.chemicalfarmers.com

Write a caption that:
1. Opens with a punchy 1-2 line hook (no generic opener like "Introducing")
2. Tells the story behind the artwork in 2-3 lines (how the signals became the art)
3. Mentions the 18-hour bidding window and starting price in ₹
4. Ends with a CTA to bid
5. Adds 15–20 hashtags (mix: #AIArt #GenerativeArt #ArtAuction #WearableArt etc.)
6. Voice: curious, slightly mysterious, playful — not corporate

Return only the caption text.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text.trim();
    } catch (err) {
      console.warn('[Instagram] Gemini caption generation failed, using fallback:', err.message);
    }
  }

  // Fallback caption
  const bulletSignals = (headline.data_signals_used_summarized || []).slice(0, 5)
    .map(s => `◆ ${s}`)
    .join('\n');

  return `${headline.title} — Lot #${lot.lotNumber}

${headline.essence}

Today's artwork emerged from:
${bulletSignals}

${(headline.interpretive_statement || '').slice(0, 220)}

18 hours. One winner. Starting at ₹${lot.startingBid}.

Bid now → oxide.chemicalfarmers.com

#OxideAtelier #AIArt #GenerativeArt #AIArtwork #DigitalArt #ArtAuction #AIGenerated #ContemporaryArt #ArtCollector #NeuralArt #VertexAI #DailyArt #LimitedEdition #WearableArt #AIArtist #FashionArt #PrintArt #UniqueArt #ArtOfTheDay #CollectibleArt`;
}

// ─── Instagram Graph API ──────────────────────────────────────────────────────

async function igPost(endpoint, token, body) {
  const res = await fetch(`${IG_API}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Instagram API error [${endpoint}]: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

/**
 * Poll a media container until its status_code is FINISHED.
 * Instagram processes containers asynchronously — publishing before FINISHED
 * throws error 9007 "Media ID is not available".
 */
async function waitForContainerReady(containerId, token, { maxAttempts = 12, delayMs = 5000 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    const res = await fetch(`${IG_API}/${containerId}?fields=status_code`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const status = data.status_code;
    console.log(`[Instagram] Container ${containerId} status: ${status} (attempt ${i + 1}/${maxAttempts})`);
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Container ${containerId} processing failed with status: ${status}`);
    }
    // IN_PROGRESS — keep polling
  }
  throw new Error(`Container ${containerId} not ready after ${maxAttempts * delayMs / 1000}s`);
}

async function createMediaContainer(userId, token, imageUrl, { caption, isCarouselItem } = {}) {
  const body = { image_url: imageUrl };
  if (isCarouselItem) body.is_carousel_item = true;
  else if (caption) body.caption = caption;
  const data = await igPost(`${userId}/media`, token, body);
  return data.id;
}

async function createCarouselContainer(userId, token, childIds, caption) {
  const data = await igPost(`${userId}/media`, token, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  });
  return data.id;
}

async function publishContainer(userId, token, containerId) {
  const data = await igPost(`${userId}/media_publish`, token, { creation_id: containerId });
  return data.id;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create and publish an Instagram carousel for a lot.
 *
 * Slide 1: artwork (resized to 1080×1080, black letterbox)
 * Slide 2: text card with title, essence, signals, and bid CTA
 * Caption: AI-generated marketing copy + hashtags
 *
 * No-ops silently if INSTAGRAM_ENABLED !== 'true' or credentials are missing.
 * Never throws — designed to be called fire-and-forget from the scheduler.
 */
export async function postLotToInstagram(lot) {
  if (process.env.INSTAGRAM_ENABLED !== 'true') {
    console.log('[Instagram] Disabled (INSTAGRAM_ENABLED != true). Skipping.');
    return null;
  }

  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !token) {
    console.warn('[Instagram] Missing INSTAGRAM_USER_ID or INSTAGRAM_ACCESS_TOKEN. Skipping.');
    return null;
  }
  if (!lot.artworkUrl) {
    console.warn(`[Instagram] Lot #${lot.lotNumber} has no artworkUrl. Skipping.`);
    return null;
  }

  try {
    console.log(`[Instagram] Preparing post for lot #${lot.lotNumber}...`);

    let headline = {};
    if (lot.artworkHeadline) {
      try {
        headline = typeof lot.artworkHeadline === 'string'
          ? JSON.parse(lot.artworkHeadline)
          : lot.artworkHeadline;
      } catch {
        console.warn('[Instagram] artworkHeadline is not valid JSON, using empty headline');
      }
    }

    // Build both images in parallel
    console.log('[Instagram] Building artwork and text card...');
    const [artworkBuffer, textCardBuffer] = await Promise.all([
      resizeArtworkForInstagram(lot.artworkUrl),
      createTextCardBuffer(headline),
    ]);

    // Upload to GCS in parallel
    console.log('[Instagram] Uploading to GCS...');
    const [artworkUrl, textCardUrl] = await Promise.all([
      uploadBufferToGCS(artworkBuffer, `lot-${lot.lotNumber}-ig-artwork.jpg`),
      uploadBufferToGCS(textCardBuffer, `lot-${lot.lotNumber}-ig-card.jpg`),
    ]);

    // Generate caption
    console.log('[Instagram] Generating caption...');
    const caption = await generateCaption(lot, headline);

    // Create carousel slide containers, then wait for each to finish processing
    // before creating the carousel — Instagram requires FINISHED status first
    console.log('[Instagram] Creating media containers...');
    const slide1Id = await createMediaContainer(userId, token, artworkUrl, { isCarouselItem: true });
    await waitForContainerReady(slide1Id, token);

    const slide2Id = await createMediaContainer(userId, token, textCardUrl, { isCarouselItem: true });
    await waitForContainerReady(slide2Id, token);

    // Create and wait for carousel container
    const carouselId = await createCarouselContainer(userId, token, [slide1Id, slide2Id], caption);
    await waitForContainerReady(carouselId, token);

    // Publish
    const postId = await publishContainer(userId, token, carouselId);
    console.log(`[Instagram] ✓ Lot #${lot.lotNumber} posted. Instagram post ID: ${postId}`);
    return postId;

  } catch (err) {
    console.error(`[Instagram] Failed to post lot #${lot.lotNumber}:`, err.message);
    return null;
  }
}
