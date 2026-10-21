// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT FILE EXPORT (PRD PAY-12)
// Builds a generic bank-upload CSV from a set of payments. This is an
// export-only artefact: Ascenda never moves funds (PRD boundary). Amounts are
// rendered from integer minor units; the account identifier is the masked
// number (raw account numbers are envelope-encrypted at rest and are not
// decrypted here — see M3 notes). RFC 4180 quoting, CRLF line endings, and a
// UTF-8 BOM so spreadsheet/bank tooling opens it correctly.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentExportRow {
  reference: string;
  workerName: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  accountNumberMasked: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  description: string;
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
        row.accountNumberMasked,
        minorUnitsToDecimal(row.amountMinorUnits),
        row.currency,
        row.status,
        row.description,
      ]
        .map((value) => csvField(String(value ?? '')))
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
