// ─────────────────────────────────────────────────────────────────────────────
// BANK ACCOUNT ENCRYPTION
//
// Account numbers are envelope-encrypted at rest (schema: BankAccount.
// accountNumberEncrypted "AES-256-GCM envelope encrypted"). We never store the
// raw number: reads and exports use the masked form only.
//
// Key material comes from BANK_ENCRYPTION_KEY: base64 of a 32-byte key. When it
// is absent we fall back to a deterministic development key so tests and local
// runs work, but production MUST set a real key.
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

const DEV_KEY = 'ascenda-dev-bank-key-000000000000000';

function resolveKey(): Buffer {
  const raw = process.env.BANK_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length === KEY_BYTES) return key;
    // Also accept a 32-char passphrase form.
    const utf8 = Buffer.from(raw, 'utf8');
    if (utf8.length === KEY_BYTES) return utf8;
    throw new Error('BANK_ENCRYPTION_KEY must be 32 bytes (base64 or raw)');
  }
  return Buffer.from(DEV_KEY, 'utf8').subarray(0, KEY_BYTES);
}

/** Envelope-encrypt a plaintext account number → `iv:tag:ciphertext` (base64). */
export function encryptAccountNumber(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, resolveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join(':');
}

/** Reverse of `encryptAccountNumber`. Throws if the payload is tampered with. */
export function decryptAccountNumber(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted account number');
  }
  const decipher = createDecipheriv(
    ALGO,
    resolveKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/** Mask an account number for display/audit, e.g. `0123456789` → `****6789`. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  const tail = digits.slice(-4).padStart(4, '*');
  return `****${tail}`;
}
