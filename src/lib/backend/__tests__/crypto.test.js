import { describe, it, expect } from 'vitest';
import { importKey, encryptField, decryptField, encryptRate, decryptRate } from '../crypto.js';

const rawKey = () => crypto.getRandomValues(new Uint8Array(32));

describe('importKey', () => {
  it('requires a 32-byte (AES-256) key', async () => {
    await expect(importKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
    await expect(importKey('not-bytes')).rejects.toThrow();
    await expect(importKey(rawKey())).resolves.toBeTruthy();
  });
});

describe('encrypt/decrypt round-trip', () => {
  it('recovers the plaintext, including unicode', async () => {
    const key = await importKey(rawKey());
    for (const s of ['Gianni Arone', '(585) 555-0100', 'café ☕ 日本語', '']) {
      const ct = await encryptField(key, s);
      expect(ct).not.toBe(s);                       // actually encrypted
      expect(await decryptField(key, ct)).toBe(s);  // round-trips
    }
    expect(await encryptField(key, null)).toBe(null);
    expect(await decryptField(key, null)).toBe(null);
  });

  it('uses a fresh IV each call (same input → different ciphertext)', async () => {
    const key = await importKey(rawKey());
    expect(await encryptField(key, 'x')).not.toBe(await encryptField(key, 'x'));
  });

  it('fails CLOSED: a wrong key or tampered ciphertext throws (never returns plaintext)', async () => {
    const key = await importKey(rawKey());
    const other = await importKey(rawKey());
    const ct = await encryptField(key, 'secret rate 23.50');
    await expect(decryptField(other, ct)).rejects.toBeTruthy();     // wrong key
    const tampered = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    await expect(decryptField(key, tampered)).rejects.toBeTruthy(); // GCM auth fail
  });

  it('encryptRate/decryptRate round-trip a number', async () => {
    const key = await importKey(rawKey());
    expect(await decryptRate(key, await encryptRate(key, 23.5))).toBe(23.5);
    expect(await decryptRate(key, await encryptRate(key, null))).toBe(null);
  });
});
