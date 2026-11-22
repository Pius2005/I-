'use node';

/**
 * CV text extraction. PDF and Word files are read in a Node action because the
 * parsers need Node buffers; the parsed result is written back by a mutation.
 */

import { internalRefs } from '../shared/refs';
import { action, internalAction } from './_generated/server';
import { v } from 'convex/values';
import mammoth from 'mammoth';
// The package entrypoint probes a bundled test fixture, so import the library
// itself; see convex/types.d.ts for its declaration.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const processCv = internalAction({
  args: { applicationId: v.id('applications') },
  handler: async (ctx, args) => {
    const cvFile = await ctx.runQuery(internalRefs.files.cvFileForApplication, {
      applicationId: args.applicationId,
    });
    if (!cvFile || !cvFile.storageId) return;

    await ctx.runMutation(internalRefs.files.markExtraction, {
      cvFileId: cvFile._id,
      status: 'PROCESSING',
    });

    try {
      const blob = await ctx.storage.get(cvFile.storageId);
      if (!blob) throw new Error('The uploaded file is no longer available.');
      const buffer = Buffer.from(await blob.arrayBuffer());

      let text = '';
      if (cvFile.mimeType === 'application/pdf' || /\.pdf$/i.test(cvFile.filename)) {
        const parsed = await pdfParse(buffer);
        text = (parsed.text ?? '').replace(/\u0000/g, '').trim();
      } else {
        const result = await mammoth.extractRawText({ buffer });
        text = (result.value ?? '').replace(/\u0000/g, '').trim();
      }

      if (text.replace(/\s/g, '').length < 40) {
        throw new Error(
          'This file looks scanned — no selectable text was found. Paste your CV text instead, or upload a text-based PDF/DOCX.',
        );
      }

      await ctx.runMutation(internalRefs.files.saveExtractedText, {
        cvFileId: cvFile._id,
        applicationId: args.applicationId,
        text: text.slice(0, 200_000),
      });
    } catch (error) {
      await ctx.runMutation(internalRefs.files.markExtraction, {
        cvFileId: cvFile._id,
        status: 'FAILED',
        error: (error as Error).message.slice(0, 500),
      });
    }
  },
});
