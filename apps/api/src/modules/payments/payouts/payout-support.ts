import { PayoutProvider, type PayoutOption } from '@ascenda/types';

/**
 * Currencies each provider can pay out to a local bank account. Keep this list
 * deliberately small and backed by provider documentation; unsupported
 * currencies are blocked before any transfer is attempted.
 */
export const PAYOUT_CURRENCIES: Record<PayoutProvider, readonly string[]> = {
  [PayoutProvider.PAYSTACK]: ['NGN', 'GHS', 'ZAR', 'KES'],
  [PayoutProvider.FLUTTERWAVE]: [
    'NGN',
    'GHS',
    'KES',
    'ZAR',
    'TZS',
    'UGX',
    'RWF',
    'XOF',
    'XAF',
    'EGP',
    'ETB',
    'MWK',
  ],
};

export const PAYOUT_PROVIDER_LABEL: Record<PayoutProvider, string> = {
  [PayoutProvider.PAYSTACK]: 'Paystack',
  [PayoutProvider.FLUTTERWAVE]: 'Flutterwave',
};

/**
 * ISO 4217 currencies with no minor unit. Amounts are stored here with the
 * platform-wide two-decimal convention, but a whole major unit is the smallest
 * amount the provider will accept, so any value that is not a multiple of 100
 * minor units would send an invalid fraction.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MWK',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function hasFractionalMajorUnits(
  amountMinorUnits: number,
  currency: string,
): boolean {
  if (!ZERO_DECIMAL_CURRENCIES.has(currency.trim().toUpperCase())) return false;
  return amountMinorUnits % 100 !== 0;
}

export function providerSupportsCurrency(
  provider: PayoutProvider,
  currency: string,
): boolean {
  return PAYOUT_CURRENCIES[provider].includes(currency.trim().toUpperCase());
}

export function payoutOptions(): PayoutOption[] {
  return (Object.keys(PAYOUT_CURRENCIES) as PayoutProvider[]).map(
    (provider) => ({
      provider,
      label: PAYOUT_PROVIDER_LABEL[provider],
      currencies: [...PAYOUT_CURRENCIES[provider]],
    }),
  );
}
