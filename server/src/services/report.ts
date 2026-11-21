import PDFDocument from 'pdfkit';
import type { AuditSnapshot } from './audit-service.js';
import { registerPdfFonts } from './pdf-fonts.js';

/**
 * Server-side PDF bias report. Rendered with PDFKit (no headless browser) and an
 * embedded Unicode font, so it works in a slim container, streams
 * deterministically and keeps Yoruba diacritics intact.
 */

// The report is deliberately monochrome (black, white, greys) so it matches the
// product's black-and-white interface, prints cleanly on any office printer and
// never relies on colour alone to signal a flagged finding.
const BLACK = '#000000';
const INK = '#111111';
const MUTED = '#525252';
const RULE = '#d4d4d4';
const SOFT = '#f4f4f5';

export function buildBiasReportPdf(snapshot: AuditSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true, info: { Title: 'Iṣẹ́ Bias Audit Report', Author: 'Iṣẹ́' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Registers the bundled DejaVu Sans pair so ṣ/ẹ (and every other Latin
    // Extended Additional glyph) render instead of disappearing.
    const hasFonts = registerPdfFonts(doc);
    const brand = hasFonts ? 'Iṣẹ́' : 'Ise';
    const setBody = (size = 10) => {
      if (hasFonts) doc.font('Body');
      doc.fontSize(size).fillColor(INK);
      return doc;
    };
    const setBold = (size = 10) => {
      if (hasFonts) doc.font('Bold');
      else doc.font('Helvetica-Bold');
      doc.fontSize(size).fillColor(INK);
      return doc;
    };

    const width = doc.page.width - 92;
    let y = 46;

    // Cover header
    doc.rect(0, 0, doc.page.width, 96).fill(BLACK);
    doc.font(hasFonts ? 'Bold' : 'Helvetica-Bold').fontSize(24);
    doc.fillColor('#ffffff').text(brand, 46, 30);
    doc.fontSize(10).fillColor('#e5e5e5');
    doc.text('Bias audit report — AI-assisted graduate screening', 46, 64);
    y = 118;

    setBold(16).text('Bias Audit Report', 46, y);
    y += 24;
    setBody(9).fillColor(MUTED);
    doc.text(
      `Scope: ${snapshot.scope.jobTitle ? `Job — ${snapshot.scope.jobTitle}` : 'Organisation-wide'}   •   Generated: ${new Date(snapshot.generatedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
      46,
      y,
    );
    y += 16;
    doc.text(`Applications analysed: ${snapshot.sampleSize}   •   With voluntary self-declaration: ${snapshot.declaredSample}`, 46, y);
    y += 22;

    const sectionTitle = (title: string) => {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 46;
      }
      setBold(12).fillColor(BLACK).text(title, 46, y);
      y += 18;
      doc.moveTo(46, y - 5).lineTo(46 + width, y - 5).strokeColor(RULE).lineWidth(1).stroke();
    };

    const paragraph = (text: string, color = INK, size = 9.5) => {
      setBody(size).fillColor(color);
      const height = doc.heightOfString(text, { width });
      if (y + height > doc.page.height - 70) {
        doc.addPage();
        y = 46;
      }
      doc.text(text, 46, y, { width });
      y += height + 8;
    };

    const bullet = (text: string) => {
      setBody(9).fillColor(INK);
      const height = doc.heightOfString(text, { width: width - 14 });
      if (y + height > doc.page.height - 70) {
        doc.addPage();
        y = 46;
      }
      doc.circle(49, y + 5, 1.8).fill(INK);
      doc.text(text, 58, y, { width: width - 12 });
      y += height + 6;
    };

    const tableHeader = (columns: { label: string; x: number; width: number }[]) => {
      setBold(8.5).fillColor(MUTED);
      for (const col of columns) doc.text(col.label.toUpperCase(), col.x, y, { width: col.width });
      y += 13;
      doc.moveTo(46, y - 4).lineTo(46 + width, y - 4).strokeColor(RULE).stroke();
    };

    const tableRow = (cells: { text: string; x: number; width: number; color?: string; bold?: boolean }[]) => {
      const heights = cells.map((c) => doc.heightOfString(c.text, { width: c.width }));
      const rowHeight = Math.max(...heights, 12) + 5;
      if (y + rowHeight > doc.page.height - 70) {
        doc.addPage();
        y = 46;
      }
      for (const cell of cells) {
        if (cell.bold) setBold(8.6);
        else setBody(8.6);
        doc.fillColor(cell.color ?? INK).text(cell.text, cell.x, y, { width: cell.width });
      }
      y += rowHeight;
    };

    sectionTitle('Plain-language findings');
    if (!snapshot.findings.length) paragraph('No findings were produced for this scope.');
    for (const finding of snapshot.findings) bullet(finding);
    y += 4;

    if (snapshot.flags.length) {
      sectionTitle(`Flagged issues (${snapshot.flags.length})`);
      for (const flag of snapshot.flags) {
        const color = flag.severity === 'severe' || flag.severity === 'high' ? BLACK : MUTED;
        setBold(9).fillColor(color).text(`${flag.code.replace(/-/g, ' ')} · ${flag.severity}`, 46, y);
        y += 13;
        paragraph(flag.message, INK, 9);
      }
    }

    for (const stage of snapshot.stages) {
      sectionTitle(`${stage.label} — selection rates`);
      const dimensions = Object.entries(stage.groups);
      for (const [dimension, data] of dimensions) {
        if (y > doc.page.height - 150) {
          doc.addPage();
          y = 46;
        }
        setBold(9.5).fillColor(INK).text(dimension.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()));
        y += 14;
        tableHeader([
          { label: 'Group', x: 52, width: 150 },
          { label: 'Selected / total', x: 210, width: 90 },
          { label: 'Rate', x: 306, width: 50 },
          { label: 'vs highest', x: 362, width: 60 },
          { label: 'Status', x: 430, width: width - 384 },
        ]);
        for (const g of data.analysis.groups) {
          const suppressed = g.suppressed;
          tableRow([
            { text: g.group, x: 52, width: 150, bold: true },
            { text: suppressed ? 'suppressed' : `${g.selected} / ${g.total}`, x: 210, width: 90 },
            { text: suppressed ? '—' : `${Math.round(g.rate * 100)}%`, x: 306, width: 50 },
            { text: suppressed ? '—' : `${Math.round(g.ratio * 100)}%`, x: 362, width: 60 },
            {
              text: suppressed ? 'Below privacy threshold' : g.flagged ? `Flagged (${g.severity})` : 'OK',
              x: 430,
              width: width - 384,
              color: g.flagged ? BLACK : MUTED,
            },
          ]);
        }
        paragraph(data.analysis.summary, MUTED, 8.5);
      }
    }

    if (snapshot.proxyFindings.length) {
      sectionTitle('Proxy bias detection');
      tableHeader([
        { label: 'Feature', x: 52, width: 120 },
        { label: 'Corr. with score', x: 180, width: 80 },
        { label: 'Corr. with group', x: 268, width: 90 },
        { label: 'Verdict', x: 366, width: width - 320 },
      ]);
      for (const p of snapshot.proxyFindings) {
        tableRow([
          { text: p.proxy, x: 52, width: 120, bold: true },
          { text: p.correlationWithScore.toFixed(2), x: 180, width: 80 },
          { text: `${p.correlationWithGroup.toFixed(2)}${p.strongestGroup ? ` (${p.strongestGroup})` : ''}`, x: 268, width: 90 },
          { text: p.flagged ? 'Possible proxy' : 'No material signal', x: 366, width: width - 320, color: p.flagged ? BLACK : MUTED },
        ]);
      }
      paragraph('Correlations describe association, not causation. A flagged proxy means the feature should be investigated and, if not job-related, removed from scoring.', MUTED, 8.5);
    }

    sectionTitle('AI recommendation vs human decision');
    for (const override of snapshot.overrideAnalysis) {
      if (!override.groups.length) continue;
      if (y > doc.page.height - 130) {
        doc.addPage();
        y = 46;
      }
      setBold(9.5).text(override.dimension);
      y += 14;
      tableHeader([
        { label: 'Group', x: 52, width: 140 },
        { label: 'People', x: 200, width: 50 },
        { label: 'Favourable overrides', x: 256, width: 110 },
        { label: 'Disfavourable overrides', x: 372, width: 110 },
        { label: 'Status', x: 486, width: width - 440 },
      ]);
      for (const g of override.groups) {
        tableRow([
          { text: g.group, x: 52, width: 140, bold: true },
          { text: String(g.total), x: 200, width: 50 },
          { text: `${g.favourableOverrides} (${Math.round(g.favourableRate * 100)}%)`, x: 256, width: 110 },
          { text: `${g.disfavourableOverrides} (${Math.round(g.disfavourableRate * 100)}%)`, x: 372, width: 110 },
          { text: g.flagged ? 'Review' : 'Typical', x: 486, width: width - 440, color: g.flagged ? BLACK : MUTED },
        ]);
      }
      paragraph(`AI/human agreement rate: ${Math.round(override.aiAgreementRate * 100)}%. ${override.note}`, MUTED, 8.5);
    }

    sectionTitle('Suggested fixes');
    if (snapshot.suggestedFixes.length) {
      for (const fix of snapshot.suggestedFixes) bullet(fix);
    } else {
      paragraph('No structural fixes are suggested by this run. Keep monitoring as more decisions are recorded.', MUTED, 9);
    }

    sectionTitle('Methodology');
    for (const note of snapshot.methodology) bullet(note);
    if (snapshot.sampleWarnings.length) {
      setBold(9).fillColor(BLACK).text('Sample-size warnings and limitations');
      y += 14;
      for (const warning of snapshot.sampleWarnings) bullet(warning);
    }

    sectionTitle('Important disclaimer');
    const disclaimer =
      'Statistical flags in this report indicate possible bias and require human investigation. They are not legal findings of discrimination, and they do not prove that any individual decision was unfair. This report must be read alongside the documented decision reasons and reviewed by a qualified person.';
    setBody(9).fillColor(BLACK);
    const disclaimerHeight = doc.heightOfString(disclaimer, { width: width - 20 }) + 16;
    if (y + disclaimerHeight > doc.page.height - 70) {
      doc.addPage();
      y = 46;
    }
    doc.rect(46, y - 6, width, disclaimerHeight).fill(SOFT);
    doc.rect(46, y - 6, 3, disclaimerHeight).fill(BLACK);
    doc.fillColor(BLACK).text(disclaimer, 58, y, { width: width - 24 });
    y += disclaimerHeight + 6;
    paragraph(
      'AI screening only recommends candidates. A human recruiter always makes the final decision. Iṣẹ́ does not automatically reject anyone on the basis of an AI score.',
      MUTED,
      9,
    );

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      setBody(7.5).fillColor(MUTED);
      doc.text(
        `${brand} bias audit • page ${i + 1} of ${range.count} • generated ${new Date(snapshot.generatedAt).toISOString().slice(0, 10)}`,
        46,
        doc.page.height - 40,
        { width, align: 'center' },
      );
    }

    doc.end();
  });
}
