// ─────────────────────────────────────────────────────────────────────────────
// YEAR-END STATEMENT PDF RENDERER (PRD PAY-16)
// Renders one frozen annual statement to a PDF buffer with pdfkit. Pure
// presentation: every number comes from the stored YearEndStatement record — no
// recomputation, so the printed document always matches the frozen totals.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import type { YearEndLine } from '@ascenda/types';
import { formatMinorUnits } from './payslip-pdf';

export interface YearEndDocumentInput {
  organisationName: string;
  workerName: string;
  employeeNumber: string;
  taxYearLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  payslipCount: number;
  validatedByProfessional: boolean;
  lines: YearEndLine[];
}

export function renderYearEndPdf(input: YearEndDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(input.organisationName, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(14).text('Year-end statement', { align: 'left' });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Employee: ${input.workerName} (${input.employeeNumber})`);
    doc.text(`Tax year: ${input.taxYearLabel}`);
    doc.text(
      `Dates: ${input.periodStart.slice(0, 10)} – ${input.periodEnd.slice(0, 10)}`,
    );
    doc.text(`Payslips included: ${input.payslipCount}`);
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
    if (!input.validatedByProfessional) {
      doc.text(
        'Statutory figures in this statement have not been validated by a payroll professional.',
      );
      doc.moveDown(0.3);
    }
    doc.text(
      'This statement is computer generated. Amounts are shown in the run currency.',
    );

    doc.end();
  });
}
