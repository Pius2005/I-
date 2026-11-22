import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Bias-report PDF, rendered in the browser.
 *
 * DejaVu Sans is embedded so Yoruba diacritics (Iṣẹ́, Adébáyọ̀) render correctly
 * in every PDF reader; the standard PDF fonts cannot encode them.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

let regularBytes: ArrayBuffer | null = null;
let boldBytes: ArrayBuffer | null = null;

async function loadFonts() {
  if (!regularBytes) {
    const response = await fetch('/fonts/DejaVuSans.ttf');
    if (!response.ok) throw new Error('Report font could not be loaded.');
    regularBytes = await response.arrayBuffer();
  }
  if (!boldBytes) {
    const response = await fetch('/fonts/DejaVuSans-Bold.ttf');
    if (!response.ok) throw new Error('Report font could not be loaded.');
    boldBytes = await response.arrayBuffer();
  }
  return { regular: regularBytes!, bold: boldBytes! };
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export async function renderBiasReportPdf(report: {
  id: string;
  createdAt: number;
  summary: any;
}): Promise<Blob> {
  const snapshot = report.summary ?? {};
  const fonts = await loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const write = (text: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = options.size ?? 10;
    const font = options.bold ? bold : regular;
    const lineHeight = size * 1.42;
    const maxChars = Math.floor(CONTENT_WIDTH / (size * 0.52));
    for (const line of wrap(text, maxChars)) {
      if (y - lineHeight < MARGIN) newPage();
      page.drawText(line, {
        x: MARGIN,
        y: y - lineHeight,
        size,
        font,
        color: options.color ?? rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    y -= options.gap ?? 6;
  };

  const rule = () => {
    if (y - 12 < MARGIN) newPage();
    page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 6 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) });
    y -= 16;
  };

  const jobTitle = snapshot.scope?.jobTitle || 'All roles';
  write('Iṣẹ́', { size: 24, bold: true, gap: 2 });
  write('Bias audit report', { size: 15, bold: true, gap: 2 });
  write(`Scope: ${jobTitle}`, { size: 11, gap: 2 });
  write(`Generated: ${new Date(snapshot.generatedAt ?? report.createdAt).toLocaleString('en-NG')}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  write(`Report ID: ${report.id}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  rule();

  write(
    `Sample: ${snapshot.sampleSize ?? 0} application(s), of which ${snapshot.declaredSample ?? 0} completed voluntary self-declaration.`,
    { size: 10 },
  );
  write(
    `Privacy threshold: groups below ${snapshot.minGroupSize ?? 5} people are suppressed. Adverse-impact threshold: ${Math.round(
      (snapshot.threshold ?? 0.8) * 100,
    )}%.`,
    { size: 10 },
  );

  write('Findings', { size: 13, bold: true, gap: 4 });
  for (const finding of snapshot.findings ?? []) write(`• ${finding}`, { size: 10 });

  write('Flags', { size: 13, bold: true, gap: 4 });
  if (!snapshot.flags?.length) write('No bias flags were raised for this scope.', { size: 10 });
  for (const flag of snapshot.flags ?? []) {
    write(`${flag.code} (${flag.severity}): ${flag.message}`, { size: 10 });
  }

  write('Selection rates by stage', { size: 13, bold: true, gap: 4 });
  for (const stage of snapshot.stages ?? []) {
    write(stage.label, { size: 11, bold: true, gap: 2 });
    for (const [key, value] of Object.entries<any>(stage.groups ?? {})) {
      const analysis = value?.analysis;
      if (!analysis) continue;
      const flaggedGroups = (analysis.groups ?? []).filter((g: any) => g.flagged);
      if (!flaggedGroups.length) continue;
      for (const group of flaggedGroups) {
        write(
          `  ${key}: ${group.group} selected at ${Math.round(group.rate * 100)}% (ratio ${group.ratio} vs ${
            analysis.highestGroup ?? 'highest'
          }) — ${group.severity} severity`,
          { size: 9.5 },
        );
      }
    }
    y += 2;
  }

  write('Proxy features', { size: 13, bold: true, gap: 4 });
  if (!snapshot.proxyFindings?.length) write('Not enough scored applications to test for proxies.', { size: 10 });
  for (const proxy of snapshot.proxyFindings ?? []) {
    write(
      `${proxy.proxy}: r=${proxy.correlationWithScore} with score, r=${proxy.correlationWithGroup} with ${
        proxy.strongestGroup ?? 'group'
      }. ${proxy.note}`,
      { size: 9.5 },
    );
  }

  write('Override analysis', { size: 13, bold: true, gap: 4 });
  for (const override of snapshot.overrideAnalysis ?? []) {
    write(
      `${override.dimension}: ${override.total} application(s), AI agreement ${Math.round(
        (override.aiAgreementRate ?? 0) * 100,
      )}%.`,
      { size: 9.5 },
    );
  }

  write('Suggested fixes', { size: 13, bold: true, gap: 4 });
  for (const fix of snapshot.suggestedFixes ?? []) write(`• ${fix}`, { size: 10 });

  write('Sample warnings', { size: 13, bold: true, gap: 4 });
  for (const warning of snapshot.sampleWarnings ?? []) write(`• ${warning}`, { size: 9.5 });

  write('Methodology', { size: 13, bold: true, gap: 4 });
  for (const line of snapshot.methodology ?? []) write(`• ${line}`, { size: 9.5 });

  rule();
  write('Statistical flags indicate possible bias and require human investigation. They are not legal findings of discrimination.', {
    size: 9,
    color: rgb(0.35, 0.35, 0.35),
  });

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
