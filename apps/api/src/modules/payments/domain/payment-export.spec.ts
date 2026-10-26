import { buildPaymentsCsv, minorUnitsToDecimal } from './payment-export';

describe('payment file export (PAY-12)', () => {
  it('renders minor units as a decimal string', () => {
    expect(minorUnitsToDecimal(123456)).toBe('1234.56');
    expect(minorUnitsToDecimal(5)).toBe('0.05');
    expect(minorUnitsToDecimal(-500000)).toBe('-5000.00');
  });

  it('emits a BOM, header row and CRLF line endings', () => {
    const csv = buildPaymentsCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('reference,worker_name');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = buildPaymentsCsv([
      {
        reference: 'PAY-1',
        workerName: 'Doe, Jane',
        accountName: 'Jane "JD" Doe',
        bankName: 'ACME Bank',
        bankCode: '000',
        accountNumber: '0123456789',
        amountMinorUnits: 100000,
        currency: 'NGN',
        status: 'PENDING',
        description: 'Payroll run 2026-09-01–2026-09-30',
        payrollRunId: 'run-1',
        paymentBatchReference: 'PB-1',
        exportedBy: 'finance@example.com',
        exportedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
    expect(csv).toContain('"Doe, Jane"');
    expect(csv).toContain('"Jane ""JD"" Doe"');
    expect(csv).toContain('1000.00,NGN');
  });
});
