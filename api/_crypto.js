// Шифрування чутливих інтеграційних токенів (Monobank etc).
// AES-256-GCM. Ключ — INTEGRATION_ENCRYPTION_KEY у Vercel env (32 байти hex).

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY not configured');
  // Приймаємо hex (64 символи = 32 байти) або base64.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes (hex or base64)');
  return buf;
}

export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
    alg: ALGO,
    v: 1,
  };
}

export function decryptSecret(payload) {
  if (!payload || !payload.iv || !payload.ct || !payload.tag) {
    throw new Error('invalid encrypted payload');
  }
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const decipher = crypto.createDecipheriv(payload.alg || ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
