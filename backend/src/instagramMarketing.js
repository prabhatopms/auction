import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';

const __dir = dirname(fileURLToPath(import.meta.url));
const IG_API = 'https://graph.instagram.com/v25.0';

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

/**
 * Build an SVG text card (1080x1080) with title, essence, signals, and CTA.
 */
function buildTextCardSvg(headline) {
  const W = 1080, H = 1080;
  const MARGIN = 80;
  const title = headline.title || 'Untitled';
  const signals = headline.data_signals_used || headline.data_signals_used_summarized || [];

  const nodes = [];
  let y = 120;

  // Title (large bold)
  for (const line of wrapText(title.toUpperCase(), 16).slice(0, 3)) {
    nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="88" fill="#FFFFFF" font-weight="bold">${escapeXml(line)}</text>`);
    y += 100;
  }
  y += 12;

  // Divider
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${W - MARGIN}" y2="${y}" stroke="#1f1f1f" stroke-width="1"/>`);
  y += 36;

  // Signals section
  if (signals.length > 0) {
    nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="20" fill="#555555" letter-spacing="4">TODAY'S SIGNALS</text>`);
    y += 36;

    for (const signal of signals.slice(0, 5)) {
      const { text: sigText, source } = parseSignal(signal);
      const full = source ? `${sigText} [${source}]` : sigText;
      const lines = wrapText(full, 52).slice(0, 2);
      const firstLine = lines[0] || '';
      const secondLine = lines[1] || '';

      if (source && firstLine.includes(`[${source}]`)) {
        // Source fits on first line — dim just the [Source] part via tspan
        const idx = firstLine.lastIndexOf(`[${source}]`);
        const before = firstLine.slice(0, idx);
        nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="24" fill="#999999">${escapeXml(before)}<tspan fill="#555555" font-style="italic">[${escapeXml(source)}]</tspan></text>`);
      } else {
        nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="24" fill="#999999">${escapeXml(firstLine)}</text>`);
      }
      y += 32;

      if (secondLine) {
        if (source && secondLine.includes(`[${source}]`)) {
          const idx = secondLine.lastIndexOf(`[${source}]`);
          const before = secondLine.slice(0, idx);
          nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="24" fill="#999999">${escapeXml(before)}<tspan fill="#555555" font-style="italic">[${escapeXml(source)}]</tspan></text>`);
        } else {
          nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="24" fill="#999999">${escapeXml(secondLine)}</text>`);
        }
        y += 32;
      }
      y += 10;
    }
    y += 8;
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#000000"/>
  ${nodes.join('\n  ')}
</svg>`;
}

async function createTextCardBuffer(headline) {
  const svg = buildTextCardSvg(headline);
  // Instagram requires JPEG — convert from SVG render
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
