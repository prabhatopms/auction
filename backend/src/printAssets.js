import { promises as fs } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { prisma } from './prisma.js';
import { generateBackPrintBuffer } from './backPrintCard.js';
import { uploadPngToGCS } from './gcsUpload.js';
import { FONT_SERIF } from './fonts.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// Final print files at 2x the live-room decal canvas (Stage.jsx
// createFrontCanvas: 1200x1600, artwork at 124,70 sized 952x1360, captions at
// baselines 1495/1545) — 2400x3200 ≈ 240 DPI on the 10x12in DTG print area.
const W = 2400;
const H = 3200;
const ART = { left: 248, top: 140, width: 1904, height: 2720 };
const LINE1 = { size: 92, baseline: 2990, text: 'Field Notes From the Day' };
const LINE2 = { size: 64, baseline: 3090 };
const BLACK_THRESHOLD = 15; // matches the client's compression-noise tolerance

export async function loadArtworkBuffer(lot) {
  const url = lot?.artworkUrl;
  if (!url) return null;

  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`artwork fetch failed: ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // GCS-failure fallback stores a relative local URL like /public/artwork/lot-N.png
  const localPath = join(__dir, '..', 'public', 'artwork', basename(url));
  return fs.readFile(localPath);
}

// Make the artwork's intrinsic black background transparent, before any
// resize — thresholding after interpolation would leave dark fringing.
export async function removeBlackBackground(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < BLACK_THRESHOLD && data[i + 1] < BLACK_THRESHOLD && data[i + 2] < BLACK_THRESHOLD) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

// Caption formatting mirrors Stage.jsx createFrontCanvas exactly.
function formatLotNo(lot) {
  if (lot?.lotNumber != null) {
    return lot.lotNumber < 0 ? 'Old ' + Math.abs(lot.lotNumber) : String(lot.lotNumber).padStart(3, '0');
  }
  return '001';
}

function formatDate(lot) {
  try {
    return new Date(lot?.startsAt || new Date()).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}

// SVG <text y> is the alphabetic baseline, same as canvas fillText — the
// client's coordinates transfer directly at 2x with no baseline conversion.
function renderCaptionPng(lot) {
  const line2 = `${formatDate(lot)}   •   Lot ${formatLotNo(lot)}   •   Edition 1/1`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="${W / 2}" y="${LINE1.baseline}" font-family="Gelasio" font-size="${LINE1.size}" fill="#ffffff" text-anchor="middle" xml:space="preserve">${escapeXml(LINE1.text)}</text>
  <text x="${W / 2}" y="${LINE2.baseline}" font-family="Gelasio" font-size="${LINE2.size}" fill="#ffffff" text-anchor="middle" xml:space="preserve">${escapeXml(line2)}</text>
</svg>`;

  // No fitTo option: resvg-js 2.6.2 silently drops custom fontFiles when
  // fitTo is passed alongside font, falling back to a built-in sans.
  const png = new Resvg(svg, {
    font: { fontFiles: [FONT_SERIF], loadSystemFonts: false, defaultFontFamily: 'Gelasio' },
  }).render().asPng();
  return Buffer.from(png);
}

export async function generateFrontPrintBuffer(lot, artworkBuffer = null) {
  const source = artworkBuffer ?? await loadArtworkBuffer(lot);
  if (!source) return null;

  const transparent = await removeBlackBackground(source);
  // fill matches the client's fixed drawImage box: a no-op for real Imagen
  // output (896x1280 is the same 7:10 ratio) and the same stretch the live
  // room applies to square fallback artwork.
  const artwork = await sharp(transparent)
    .resize(ART.width, ART.height, { fit: 'fill' })
    .png()
    .toBuffer();

  return sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: artwork, left: ART.left, top: ART.top },
      { input: renderCaptionPng(lot), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

// Generate + upload both print files and persist their URLs on the lot.
// Each side fails independently and never throws — lot creation and order
// placement must not break on print-asset problems. Versioned filenames avoid
// GCS edge caches serving stale files after an admin artwork swap.
export async function generatePrintAssets(lot, { force = false } = {}) {
  if (!lot) return lot;
  const ts = Date.now();
  const data = {};

  if (force || !lot.frontPrintUrl) {
    try {
      const front = await generateFrontPrintBuffer(lot);
      if (front) {
        const url = await uploadPngToGCS(front, `front-print/lot-${lot.lotNumber}-${ts}.png`);
        if (url) data.frontPrintUrl = url;
      }
    } catch (e) {
      console.error(`[PrintAssets] Front print failed for lot #${lot.lotNumber}:`, e.message);
    }
  }

  if (force || !lot.backPrintUrl) {
    try {
      const back = await generateBackPrintBuffer(lot); // null when no signals
      if (back) {
        const url = await uploadPngToGCS(back, `back-print/lot-${lot.lotNumber}-${ts}.png`);
        if (url) data.backPrintUrl = url;
      }
    } catch (e) {
      console.error(`[PrintAssets] Back print failed for lot #${lot.lotNumber}:`, e.message);
    }
  }

  if (Object.keys(data).length === 0) return lot;

  try {
    const updated = await prisma.lot.update({ where: { id: lot.id }, data });
    console.log(`[PrintAssets] Lot #${lot.lotNumber}: ${Object.keys(data).join(', ')} generated.`);
    return updated;
  } catch (e) {
    console.error(`[PrintAssets] Failed to persist URLs for lot #${lot.lotNumber}:`, e.message);
    return { ...lot, ...data };
  }
}
