// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT FILE EXPORT (PRD PAY-12)
// Builds a generic bank-upload CSV from a set of payments. This is an
// export-only artefact: Ascenda never moves funds (PRD boundary). Amounts are
// rendered from integer minor units. SECURITY.md §6 requires the file to be
// permissioned, re-authenticated, audited and watermarked with the run id and
// exporter, so those fields are emitted on every row. RFC 4180 quoting, CRLF
// line endings, and a UTF-8 BOM so spreadsheet/bank tooling opens it correctly.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentExportRow {
  reference: string;
  workerName: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  /** Full account number, decrypted for the bank file (never logged). */
  accountNumber: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  description: string;
  /** Audit watermark: payroll run / batch + exporter + timestamp. */
  payrollRunId: string;
  paymentBatchReference: string;
  exportedBy: string;
  exportedAt: string;
}

const COLUMNS = [
  'reference',
  'worker_name',
  'account_name',
  'bank_name',
  'bank_code',
  'account_number',
  'amount',
  'currency',
  'status',
  'description',
  'payroll_run_id',
  'payment_batch',
  'exported_by',
  'exported_at',
] as const;

/** Render minor units as a plain decimal string (e.g. 123456 → "1234.56"). */
export function minorUnitsToDecimal(amountMinorUnits: number): string {
  const sign = amountMinorUnits < 0 ? '-' : '';
  const abs = Math.abs(amountMinorUnits);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildPaymentsCsv(rows: PaymentExportRow[]): string {
  const lines: string[] = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.reference,
        row.workerName,
        row.accountName,
        row.bankName,
        row.bankCode,
        row.accountNumber,
        minorUnitsToDecimal(row.amountMinorUnits),
        row.currency,
        row.status,
        row.description,
        row.payrollRunId,
        row.paymentBatchReference,
        row.exportedBy,
        row.exportedAt,
      ]
        .map((value) => csvField(String(value ?? '')))
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
