import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Bundled WOFF — no CDN dependency, no fontconfig. Loading these from a CDN or
// relying on system fonts broke repeatedly on Railway's Linux environment.
export const FONT_REGULAR = join(__dir, 'fonts', 'Roboto-Regular.woff');
export const FONT_BOLD = join(__dir, 'fonts', 'Roboto-Bold.woff');
// TTF (not WOFF): resvg's font loader only parses ttf/otf; satori reads it too.
export const FONT_SERIF = join(__dir, 'fonts', 'Gelasio-Regular.ttf');

let _fonts = null;
export async function ensureFonts() {
  if (_fonts) return _fonts;
  const [regular, bold] = await Promise.all([
    fs.readFile(FONT_REGULAR),
    fs.readFile(FONT_BOLD),
  ]);
  // satori needs ArrayBuffer; Buffer.buffer may be a shared pool so slice it
  const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  _fonts = [
    { name: 'Roboto', data: toAB(regular), weight: 400, style: 'normal' },
    { name: 'Roboto', data: toAB(bold), weight: 700, style: 'normal' },
  ];
  console.log('[Fonts] Roboto WOFF fonts loaded from disk.');
  return _fonts;
}

// Serif for print files — Gelasio is metric-compatible with Georgia, which the
// frontend canvases used, so printed text matches what bidders saw on screen.
let _serifFonts = null;
export async function ensureSerifFonts() {
  if (_serifFonts) return _serifFonts;
  const serif = await fs.readFile(FONT_SERIF);
  const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  _serifFonts = [
    { name: 'Gelasio', data: toAB(serif), weight: 400, style: 'normal' },
  ];
  console.log('[Fonts] Gelasio TTF font loaded from disk.');
  return _serifFonts;
}
