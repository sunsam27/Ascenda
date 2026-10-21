// ─────────────────────────────────────────────────────────────────────────────
// PAYSLIP PDF RENDERER (PRD PAY-13)
// Renders one payslip to a PDF buffer with pdfkit. Pure presentation: every
// number comes from the frozen Payslip record — no recomputation, so the printed
// document always matches the processed run to the smallest unit.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import type { PayslipLine } from '@ascenda/types';

export interface PayslipDocumentInput {
  organisationName: string;
  workerName: string;
  employeeNumber: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  lines: PayslipLine[];
}

/** Render minor units as a plain decimal string (e.g. 123456 → "1234.56"). */
export function formatMinorUnits(amountMinorUnits: number, currency: string): string {
  const sign = amountMinorUnits < 0 ? '-' : '';
  const abs = Math.abs(amountMinorUnits);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}

export function renderPayslipPdf(input: PayslipDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(input.organisationName, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(14).text('Payslip', { align: 'left' });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Employee: ${input.workerName} (${input.employeeNumber})`);
    doc.text(`Period: ${input.periodLabel}`);
    doc.text(
      `Dates: ${input.periodStart.slice(0, 10)} – ${input.periodEnd.slice(0, 10)}`,
    );
    doc.moveDown(1);

    const left = doc.x;
    const right = doc.page.width - doc.page.margins.right;
    doc.fontSize(11).text('Description', left, doc.y, { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(10);

    for (const line of input.lines) {
      const y = doc.y;
      doc.text(line.description, left, y, { width: right - left - 120 });
      doc.text(formatMinorUnits(line.amountMinorUnits, input.currency), left, y, {
        width: right - left,
        align: 'right',
      });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.6);
    const dividerY = doc.y;
    doc
      .moveTo(left, dividerY)
      .lineTo(right, dividerY)
      .strokeColor('#cccccc')
      .stroke();
    doc.moveDown(0.6);

    const total = (label: string, amount: number, bold = false): void => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, left, y, { width: right - left - 120 });
      doc.text(formatMinorUnits(amount, input.currency), left, y, {
        width: right - left,
        align: 'right',
      });
      doc.moveDown(0.2);
    };

    total('Gross', input.grossMinorUnits);
    total('Deductions', -input.deductionsMinorUnits);
    total('Net pay', input.netMinorUnits, true);
    if (input.employerCostsMinorUnits > 0) {
      doc.moveDown(0.4);
      total('Employer contributions (cost, not deducted)', input.employerCostsMinorUnits);
    }

    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(
      'This payslip is computer generated. Amounts are shown in the run currency.',
    );

    doc.end();
  });
}
