import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dir = dirname(fileURLToPath(import.meta.url));
const IG_API = 'https://graph.instagram.com/v25.0';

// ─── Font loader (bundled TTF — no CDN dependency, no fontconfig) ─────────────

const FONT_REGULAR = join(__dir, 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD    = join(__dir, 'fonts', 'Roboto-Bold.ttf');

let _fonts = null;
async function ensureFonts() {
  if (_fonts) return _fonts;
  const [regular, bold] = await Promise.all([
    fs.readFile(FONT_REGULAR),
    fs.readFile(FONT_BOLD),
  ]);
  _fonts = [
    { name: 'Roboto', data: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength), weight: 400, style: 'normal' },
    { name: 'Roboto', data: bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength),    weight: 700, style: 'normal' },
  ];
  console.log('[Instagram] Roboto TTF fonts loaded from disk.');
  return _fonts;
}

// ─── Signal parser ────────────────────────────────────────────────────────────

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

// ─── Text card builder (satori element tree) ─────────────────────────────────

function buildTextCardElement(headline) {
  const GOLD = '#c9a84c';
  const M = 80;
  const W = 1080;

  const title = (headline.title || 'Untitled').toUpperCase();
  const signals = (headline.data_signals_used || headline.data_signals_used_summarized || []).slice(0, 5);

  // Satori rule: every div with >1 child needs display:flex.
  // Use explicit padding/margin properties — shorthand is not supported.
  const abs = (style) => ({ type: 'div', props: { style: { display: 'flex', position: 'absolute', ...style } } });

  const L = 52, T = 2;
  const brackets = [
    abs({ top: M - 2, left: M - 2, width: L, height: T, background: GOLD }),
    abs({ top: M - 2, left: M - 2, width: T, height: L, background: GOLD }),
    abs({ top: M - 2, right: M - 2, width: L, height: T, background: GOLD }),
    abs({ top: M - 2, right: M - 2, width: T, height: L, background: GOLD }),
    abs({ bottom: M - 2, left: M - 2, width: L, height: T, background: GOLD }),
    abs({ bottom: M - 2, left: M - 2, width: T, height: L, background: GOLD }),
    abs({ bottom: M - 2, right: M - 2, width: L, height: T, background: GOLD }),
    abs({ bottom: M - 2, right: M - 2, width: T, height: L, background: GOLD }),
  ];

  const signalRows = signals.map(sig => {
    const { text, source } = parseSignal(sig);
    return {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
        children: [
          { type: 'span', props: { style: { color: GOLD, fontSize: 20, marginRight: 10, marginTop: 3 }, children: ['—'] } },
          { type: 'span', props: {
            style: { color: '#b0b0b0', fontSize: 24, flex: 1, lineHeight: 1.45 },
            children: [source ? `${text} [${source}]` : text],
          }},
        ],
      },
    };
  });

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'relative',
        width: W,
        height: W,
        background: '#080808',
        fontFamily: 'Roboto',
      },
      children: [
        ...brackets,
        abs({ top: 140, left: M, width: W - M * 2, height: 1, background: GOLD, opacity: 0.5 }),
        abs({ bottom: 134, left: M, width: W - M * 2, height: 1, background: GOLD, opacity: 0.5 }),
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              paddingTop: 180,
              paddingBottom: 180,
              paddingLeft: M,
              paddingRight: M,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', fontSize: 96, fontWeight: 700, color: '#FFFFFF', letterSpacing: -2, lineHeight: 1.05, marginBottom: 16 },
                  children: [title],
                },
              },
              { type: 'div', props: { style: { display: 'flex', width: 160, height: 2, background: GOLD, marginBottom: 36 } } },
              { type: 'div', props: {
                style: { display: 'flex', fontSize: 16, color: GOLD, letterSpacing: 6, marginBottom: 16 },
                children: ["TODAY'S SIGNALS"],
              }},
              { type: 'div', props: { style: { display: 'flex', width: W - M * 2, height: 1, background: '#222222', marginBottom: 24 } } },
              ...signalRows,
            ],
          },
        },
      ],
    },
  };
}

// ─── Image creation ───────────────────────────────────────────────────────────

export async function createTextCardBuffer(headline) {
  const fonts = await ensureFonts();
  const element = buildTextCardElement(headline);
  const svg = await satori(element, { width: 1080, height: 1080, fonts });
  const png = new Resvg(svg, {
    fitTo: { mode: 'originalSize' },
    font: {
      fontFiles: [FONT_REGULAR, FONT_BOLD],
      loadSystemFonts: false,
    },
  }).render().asPng();
  return await sharp(Buffer.from(png)).jpeg({ quality: 95 }).toBuffer();
}

/**
 * Fetch the artwork and resize it to 1080x1080 (contain, black background).
 */
export async function resizeArtworkForInstagram(artworkUrl) {
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

export async function uploadBufferToGCS(buffer, filename) {
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
