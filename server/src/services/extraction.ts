import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { ApiError } from '../lib/errors.js';

const require = createRequire(import.meta.url);
// pdf-parse ships a debug entrypoint that reads a test file when required as a
// module root; requiring the library file directly avoids that.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CV_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

export function assertCvFile(file: { mimetype: string; size: number; originalname: string }) {
  if (file.size > MAX_CV_BYTES) {
    throw ApiError.badRequest('Your CV must be 5 MB or smaller.');
  }
  const isDocx = /\.docx$/i.test(file.originalname);
  const isPdf = /\.pdf$/i.test(file.originalname);
  const isDoc = /\.doc$/i.test(file.originalname);
  if (!ALLOWED_CV_MIME.includes(file.mimetype) && !isDocx && !isPdf && !isDoc) {
    throw ApiError.badRequest('Upload a PDF or Word (.docx) CV.');
  }
}

export interface ExtractionResult {
  text: string;
  pages?: number;
  warning?: string;
}

/** Extracts plain text from a PDF or DOCX buffer. */
export async function extractCvText(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractionResult> {
  try {
    if (mimeType === 'application/pdf' || /\.pdf$/i.test(filename)) {
      const parsed = await pdfParse(buffer);
      const text = (parsed.text ?? '').replace(/\u0000/g, '').trim();
      if (text.replace(/\s/g, '').length < 40) {
        throw new Error('This PDF looks scanned — no selectable text was found.');
      }
      return { text, pages: parsed.numpages };
    }
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value ?? '').replace(/\u0000/g, '').trim();
    if (text.replace(/\s/g, '').length < 40) {
      throw new Error('This document appears to be empty or image-only.');
    }
    return { text, warning: result.messages?.length ? 'Some formatting could not be read.' : undefined };
  } catch (error) {
    const message = (error as Error).message || 'Unknown extraction error';
    throw new ApiError(
      422,
      'CV_UNREADABLE',
      'We could not read this file. It may be scanned or password-protected. Re-upload a text-based PDF/DOCX, or paste your CV text instead.',
      { reason: message },
    );
  }
}
