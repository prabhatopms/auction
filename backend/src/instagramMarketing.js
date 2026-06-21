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

// ─── Image creation ───────────────────────────────────────────────────────────

/**
 * Build an SVG text card (1080x1080) with title, essence, signals, and CTA.
 */
function buildTextCardSvg(headline) {
  const W = 1080, H = 1080;
  const MARGIN = 80;
  const title = headline.title || 'Untitled';
  const essence = headline.essence || '';
  const signals = headline.data_signals_used_summarized || [];
  const statement = headline.interpretive_statement || '';

  const nodes = [];
  let y = 105;

  // Brand name
  nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="24" fill="#555555" letter-spacing="7" font-weight="bold">OXIDE ATELIER</text>`);
  y += 28;

  // Brand underline
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="560" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`);
  y += 62;

  // Title (large bold)
  for (const line of wrapText(title.toUpperCase(), 16).slice(0, 3)) {
    nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="88" fill="#FFFFFF" font-weight="bold">${escapeXml(line)}</text>`);
    y += 100;
  }
  y += 12;

  // Divider
  nodes.push(`<line x1="${MARGIN}" y1="${y}" x2="${W - MARGIN}" y2="${y}" stroke="#1f1f1f" stroke-width="1"/>`);
  y += 36;

  // Essence
  if (essence) {
    for (const line of wrapText(essence, 46).slice(0, 4)) {
      nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="30" fill="#CCCCCC">${escapeXml(line)}</text>`);
      y += 40;
    }
    y += 20;
  }

  // Signals section
  if (signals.length > 0) {
    nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="20" fill="#555555" letter-spacing="4">TODAY'S SIGNALS</text>`);
    y += 36;

    for (const signal of signals.slice(0, 5)) {
      nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="25" fill="#999999">◆  ${escapeXml(signal)}</text>`);
      y += 36;
    }
    y += 12;
  }

  // Interpretive statement (small italic, if space allows)
  if (statement && y < 850) {
    for (const line of wrapText(statement, 60).slice(0, 3)) {
      if (y >= 850) break;
      nodes.push(`<text x="${MARGIN}" y="${y}" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="21" fill="#666666" font-style="italic">${escapeXml(line)}</text>`);
      y += 30;
    }
  }

  // Bottom divider
  nodes.push(`<line x1="${MARGIN}" y1="930" x2="${W - MARGIN}" y2="930" stroke="#1f1f1f" stroke-width="1"/>`);

  // CTA
  nodes.push(`<text x="${MARGIN}" y="975" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="26" fill="#FFFFFF" font-weight="bold">Bid now → oxide.chemicalfarmers.com</text>`);
  nodes.push(`<text x="${MARGIN}" y="1015" font-family="Liberation Sans,Arial,Helvetica,sans-serif" font-size="20" fill="#444444">One artwork. 18 hours. One winner.</text>`);

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
