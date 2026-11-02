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
