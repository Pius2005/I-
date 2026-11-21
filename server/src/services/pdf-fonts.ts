import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PDFKit's built-in Helvetica uses WinAnsi encoding, which has no glyphs for the
 * Yoruba sub-dot letters in the product name (ṣ U+1E63, ẹ U+1EB9). With the
 * built-in fonts those characters are silently dropped, so every report renders
 * through an embedded Unicode TTF instead.
 *
 * A DejaVu Sans pair is bundled at `server/assets/fonts` (Bitstream Vera /
 * DejaVu licence, freely redistributable). PDF_FONT_PATH and PDF_FONT_BOLD_PATH
 * can point somewhere else; system fonts are only a last-resort fallback.
 */

export const BODY_FONT_FILE = 'DejaVuSans.ttf';
export const BOLD_FONT_FILE = 'DejaVuSans-Bold.ttf';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const BUNDLED_SUBDIRS = ['assets/fonts', join('server', 'assets', 'fonts')];

const SYSTEM_BODY = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
];

const SYSTEM_BOLD = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/noto/NotoSans-Bold.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
];

/** Walk up from a directory looking for `<dir>/assets/fonts/<file>`. */
function bundledFontFrom(start: string, file: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 7; depth += 1) {
    for (const sub of BUNDLED_SUBDIRS) {
      const candidate = join(dir, sub, file);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function firstExisting(candidates: (string | undefined | null)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export interface PdfFonts {
  body: string;
  bold: string;
  embedded: boolean;
}

let cached: PdfFonts | null | undefined;

export function resolvePdfFonts(): PdfFonts | null {
  if (cached !== undefined) return cached;
  const body =
    firstExisting([process.env.PDF_FONT_PATH]) ??
    bundledFontFrom(MODULE_DIR, BODY_FONT_FILE) ??
    bundledFontFrom(process.cwd(), BODY_FONT_FILE) ??
    firstExisting(SYSTEM_BODY);
  if (!body) {
    cached = null;
    return cached;
  }
  const bold =
    firstExisting([process.env.PDF_FONT_BOLD_PATH]) ??
    bundledFontFrom(MODULE_DIR, BOLD_FONT_FILE) ??
    bundledFontFrom(process.cwd(), BOLD_FONT_FILE) ??
    firstExisting(SYSTEM_BOLD) ??
    body;
  cached = { body, bold, embedded: true };
  return cached;
}

/**
 * Registers the `Body` and `Bold` font names on a document.
 * Returns false only when no usable TTF exists at all (PDFKit's WinAnsi
 * built-ins are then used and diacritics will not render).
 */
export function registerPdfFonts(doc: PDFKit.PDFDocument): boolean {
  const fonts = resolvePdfFonts();
  if (!fonts) return false;
  doc.registerFont('Body', fonts.body);
  doc.registerFont('Bold', fonts.bold);
  return true;
}

/** Text is only safe to emit through the built-in fonts when it is ASCII. */
export function hasNonLatinGlyphs(text: string): boolean {
  return /[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u00b7]/.test(text);
}
