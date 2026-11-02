import { PayoutProviderError } from './payout-provider';

const REQUEST_TIMEOUT_MS = 20_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? (value as JsonRecord) : null;
}

function providerMessage(body: unknown): string | undefined {
  const record = asRecord(body);
  const message = record?.message ?? record?.error;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

export async function payoutRequest(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new PayoutProviderError(
      `${provider} could not be reached. Please try again.`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    throw new PayoutProviderError(
      providerMessage(body) ??
        `${provider} rejected the request (HTTP ${response.status}).`,
      response.status,
      response.status >= 500 || response.status === 429,
    );
  }

  return body;
}

export function asJsonRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    throw new PayoutProviderError('Unexpected response from payout provider.');
  }
  return record;
}

export function asJsonArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function idValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
