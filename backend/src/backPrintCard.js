import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ensureSerifFonts, FONT_SERIF } from './fonts.js';

// Back print card: the day's data signals as centered white serif text on a
// transparent canvas. Mirrors the live-room back decal (Stage.jsx
// createBackCanvas: 27px Georgia on 1200x1600, block centered at 1/4 height),
// rendered at 2x for print (2400x3200 ≈ 240 DPI on a 10x12in DTG area).
const W = 2400;
const H = 3200;
const FONT_SIZE = 54;    // 2x the client's 27px
const LINE_HEIGHT = 84;  // 2x the client's 42px
const TEXT_WIDTH = 1440; // 2x the client's 720px wrap width

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
  // NBSPs around the bullet survive satori's whitespace collapsing while the
  // plain spaces at the edges still allow line wrapping (client uses '   •   ').
  const text = signalsSummarized.join('  •  ');
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: W,
        height: H,
        flexDirection: 'column',
      },
      children: [
        {
          // Top half of the canvas with the block centered in it — matches the
          // client's vertical centering of the text block at 1/4 canvas height.
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: W,
              height: H / 2,
              justifyContent: 'center',
              alignItems: 'center',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    width: TEXT_WIDTH,
                    justifyContent: 'center',
                    textAlign: 'center',
                    color: '#FFFFFF',
                    fontFamily: 'Gelasio',
                    fontSize: FONT_SIZE,
                    lineHeight: LINE_HEIGHT / FONT_SIZE,
                  },
                  children: [text],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export async function generateBackPrintBuffer(lot) {
  const signals = parseSummarizedSignals(lot);
  if (signals.length === 0) return null;

  const fonts = await ensureSerifFonts();
  const element = buildBackTextElement(signals);
  const svg = await satori(element, { width: W, height: H, fonts });
  const png = new Resvg(svg, {
    fitTo: { mode: 'originalSize' },
    font: { fontFiles: [FONT_SERIF], loadSystemFonts: false },
  }).render().asPng();
  return Buffer.from(png);
}
