// ─────────────────────────────────────────────────────────────────────────────
// BANK DETECTION (NIGERIA — NUBAN)
//
// True bank detection requires the paying bank's lookup API (e.g. Paystack
// `/bank/resolve`), which the platform does not call here. Instead we use the
// NUBAN convention: a 10-digit account number's first three digits identify the
// issuing bank for many institutions. This is a *best-effort* heuristic — when
// it cannot confidently match, the caller must fall back to a manual dropdown.
//
// The value returned is a bank code/label pair drawn from a static NG bank list.
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectedBank {
  bankCode: string;
  bankName: string;
}

/**
 * Static Nigerian bank list (code → name). Codes are CBN/NIBSS institution
 * codes. Kept deliberately small and well-known; the dropdown is driven from
 * the same list so both paths agree.
 */
export const NG_BANKS: DetectedBank[] = [
  { bankCode: '044', bankName: 'Access Bank' },
  { bankCode: '063', bankName: 'Access Bank (Diamond)' },
  { bankCode: '035', bankName: 'Wema Bank' },
  { bankCode: '035A', bankName: 'ALAT by Wema' },
  { bankCode: '057', bankName: 'Zenith Bank' },
  { bankCode: '011', bankName: 'First Bank of Nigeria' },
  { bankCode: '058', bankName: 'Guaranty Trust Bank' },
  { bankCode: '070', bankName: 'Fidelity Bank' },
  { bankCode: '232', bankName: 'Sterling Bank' },
  { bankCode: '032', bankName: 'Union Bank of Nigeria' },
  { bankCode: '033', bankName: 'United Bank for Africa' },
  { bankCode: '215', bankName: 'Unity Bank' },
  { bankCode: '050', bankName: 'Ecobank Nigeria' },
  { bankCode: '084', bankName: 'Enterprise Bank' },
  { bankCode: '076', bankName: 'Polaris Bank' },
  { bankCode: '221', bankName: 'Stanbic IBTC Bank' },
  { bankCode: '068', bankName: 'Standard Chartered Bank' },
  { bankCode: '100', bankName: 'Suntrust Bank' },
  { bankCode: '302', bankName: 'TAJBank' },
  { bankCode: '303', bankName: 'Lotus Bank' },
  { bankCode: '501', bankName: 'Providus Bank' },
  { bankCode: '502', bankName: 'Rand Merchant Bank' },
  { bankCode: '103', bankName: 'Globus Bank' },
  { bankCode: '301', bankName: 'Jaiz Bank' },
  { bankCode: '030', bankName: 'Heritage Bank' },
  { bankCode: '214', bankName: 'First City Monument Bank' },
  { bankCode: '023', bankName: 'Citibank Nigeria' },
  { bankCode: '082', bankName: 'Keystone Bank' },
  { bankCode: '999', bankName: 'VFD Microfinance Bank' },
  { bankCode: '100033', bankName: 'Moniepoint MFB' },
  { bankCode: '100004', bankName: 'OPay Digital Services' },
  { bankCode: '100039', bankName: 'PalmPay' },
  { bankCode: '090110', bankName: 'Kuda Microfinance Bank' },
];

/**
 * A few well-known prefix → institution mappings. NUBAN prefixes are not a
 * public standard, so this table is intentionally conservative: only prefixes
 * with a reliable, widely-observed association are listed. Everything else
 * returns null and the UI falls back to the dropdown.
 */
const PREFIX_MAP: Record<string, string> = {
  '044': '044', // Access Bank
  '057': '057', // Zenith Bank
  '011': '011', // First Bank
  '058': '058', // GTBank
  '033': '033', // UBA
  '070': '070', // Fidelity
  '032': '032', // Union Bank
  '035': '035', // Wema/ALAT
  '214': '214', // FCMB
  '221': '221', // Stanbic IBTC
  '050': '050', // Ecobank
  '076': '076', // Polaris
  '232': '232', // Sterling
  '023': '023', // Citibank
  '030': '030', // Heritage
  '082': '082', // Keystone
  '215': '215', // Unity
  '084': '084', // Enterprise
  '068': '068', // Standard Chartered
};

/** NUBAN account numbers are exactly 10 digits. */
export function isNubanAccountNumber(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

/**
 * Best-effort bank detection from a 10-digit NUBAN. Returns null when the
 * account number is malformed or its prefix is not confidently mapped — callers
 * must then require a manual bank selection.
 */
export function detectBankFromAccountNumber(
  accountNumber: string,
): DetectedBank | null {
  const digits = accountNumber.replace(/\s+/g, '');
  if (!isNubanAccountNumber(digits)) return null;
  const code = PREFIX_MAP[digits.slice(0, 3)];
  if (!code) return null;
  return NG_BANKS.find((b) => b.bankCode === code) ?? null;
}
