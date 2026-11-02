import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secretKey: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

export function verifyFlutterwaveHash(
  hash: string | undefined,
  webhookSecret: string,
): boolean {
  if (!hash) return false;
  const left = Buffer.from(hash, 'utf8');
  const right = Buffer.from(webhookSecret, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
