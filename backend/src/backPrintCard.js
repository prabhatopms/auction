import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { Storage } from '@google-cloud/storage';
import { ensureFonts, FONT_REGULAR, FONT_BOLD } from './fonts.js';

// Matches the live-room back decal canvas (Stage.jsx / PeekModal.jsx createBackCanvas):
// 1200x1600, transparent background, centered white text listing the day's signals.
const W = 1200;
const H = 1600;

function parseSummarizedSignals(lot) {
  if (!lot?.artworkHeadline) return [];
  try {
    const parsed = typeof lot.artworkHeadline === 'string'
      ? JSON.parse(lot.artworkHeadline)
      : lot.artworkHeadline;
    return parsed.data_signals_used_summarized || [];
  } catch {
    return [];
  }
}

function buildBackTextElement(signalsSummarized) {
  const text = signalsSummarized.join('   •   ');
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: W,
        height: H,
        justifyContent: 'center',
        paddingTop: 340,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: 880,
              justifyContent: 'center',
              textAlign: 'center',
              color: '#FFFFFF',
              fontFamily: 'Roboto',
              fontSize: 36,
              lineHeight: 1.6,
              letterSpacing: 0.5,
            },
            children: [text],
          },
        },
      ],
    },
  };
}

export async function generateBackPrintBuffer(lot) {
  const signals = parseSummarizedSignals(lot);
  if (signals.length === 0) return null;

  const fonts = await ensureFonts();
  const element = buildBackTextElement(signals);
  const svg = await satori(element, { width: W, height: H, fonts });
  const png = new Resvg(svg, {
    fitTo: { mode: 'originalSize' },
    font: { fontFiles: [FONT_REGULAR, FONT_BOLD], loadSystemFonts: false },
  }).render().asPng();
  return Buffer.from(png);
}

// Cached by lot number in GCS — regenerating on every order is wasted work since
// a closed lot's signals never change.
export async function getOrGenerateBackPrintUrl(lot) {
  if (!process.env.GCS_BUCKET_NAME) return null;

  const destination = `back-print/lot-${lot.lotNumber}.png`;
  const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destination}`;

  try {
    const check = await fetch(gcsUrl, { method: 'HEAD' });
    if (check.ok) return gcsUrl;
  } catch {
    // fall through to generate
  }

  const buffer = await generateBackPrintBuffer(lot);
  if (!buffer) return null;

  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
  const file = bucket.file(destination);
  await file.save(buffer, {
    contentType: 'image/png',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  try {
    await file.makePublic();
  } catch {
    const verify = await fetch(gcsUrl, { method: 'HEAD' });
    if (!verify.ok) {
      console.warn('[BackPrint] GCS object not publicly accessible:', gcsUrl);
      return null;
    }
  }

  console.log(`[BackPrint] Generated back-print card for lot #${lot.lotNumber}: ${gcsUrl}`);
  return gcsUrl;
}
