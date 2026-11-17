import PDFDocument from 'pdfkit';
import type { AnalyticsReport, AnalyticsReportColumn } from '@ascenda/types';

export interface ReportWatermark {
  organisationId: string;
  actorId: string;
  exportedAt: string;
}

/** Format the existing two-decimal money convention without floating-point division. */
export function reportCell(
  value: string | number | null | undefined,
  column: AnalyticsReportColumn,
): string {
  if (value === null || value === undefined) return 'Hidden';
  if (
    column.kind === 'number' &&
    (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Invalid report number');
  if (column.kind !== 'money') return String(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Invalid report money');
  const digits = String(Math.abs(value)).padStart(3, '0');
  return `${value < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function csvText(value: string): string {
  // Quote escaping is not formula protection. Prefix untrusted spreadsheet text separately.
  const safe =
    /^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderReportCsv(report: AnalyticsReport, watermark: ReportWatermark): string {
  const metadata = [
    report.title,
    report.from,
    report.to,
    report.scope,
    watermark.organisationId,
    watermark.actorId,
    watermark.exportedAt,
    report.description,
  ];
  const header = [
    'report',
    'period_from',
    'period_to',
    'scope',
    'organisation_id',
    'exported_by',
    'exported_at',
    'definition',
    'record_status',
    ...report.columns.map((column) => column.label),
  ];
  const rows = report.rows.length ? report.rows : [{}];
  const lines = rows.map((row) =>
    [
      ...metadata.map(csvText),
      report.rows.length ? 'data' : 'no_data',
      ...report.columns.map((column) => {
        if (!report.rows.length) return '';
        const value = reportCell(row[column.key], column);
        return column.kind === 'text' || row[column.key] == null ? csvText(value) : value;
      }),
    ].join(','),
  );
  return `\uFEFF${[header.map(csvText).join(','), ...lines].join('\r\n')}\r\n`;
}

/** Paginated labelled records rather than a wide, unreadably small table. */
export function renderReportPdf(
  report: AnalyticsReport,
  watermark: ReportWatermark,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: {
        Title: report.title,
        Author: 'Ascenda',
        Subject: `${report.from} to ${report.to}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 96;
    const text = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(16).text(report.title, 48, 48, { width });
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(`${report.from} to ${report.to} | ${report.scope} scope`, { width });
      doc.moveDown(0.5);
    };
    header();
    doc.text(text(report.description), { width });
    doc.moveDown();
    if (!report.rows.length) doc.text('No data for the selected period.');
    for (const [index, row] of report.rows.entries()) {
      if (doc.y > doc.page.height - 160) {
        doc.addPage();
        header();
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`Record ${index + 1}`);
      doc.font('Helvetica');
      for (const column of report.columns) {
        const value = `${column.label}: ${text(reportCell(row[column.key], column))}`;
        // Break very long values so no PDFKit-created overflow page loses the watermark.
        for (let offset = 0; offset < value.length; offset += 180) {
          const part = value.slice(offset, offset + 180);
          const height = doc.heightOfString(part, { width });
          if (doc.y + height > doc.page.height - 100) {
            doc.addPage();
            header();
          }
          doc.text(part, { width });
        }
      }
      doc.moveDown();
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Organisation: ${text(watermark.organisationId)} | Exporter: ${text(watermark.actorId)}\n${watermark.exportedAt} | Page ${i + 1} of ${pages.count} | ${report.rows.length} records`,
          48,
          doc.page.height - 76,
          { width, lineBreak: false },
        );
    }
    doc.end();
  });
}
