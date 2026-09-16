import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { urlBase64ToUint8Array } from '../push.js';

describe('urlBase64ToUint8Array', () => {
  it('decodes unpadded url-safe base64', () => {
    expect([...urlBase64ToUint8Array('aGVsbG8')]).toEqual([104, 101, 108, 108, 111]); // "hello"
  });
  it('maps - and _ back to + and /', () => {
    const bytes = [0xfb, 0xff, 0xbf, 0x3e];
    const std = Buffer.from(bytes).toString('base64');
    expect(std).toMatch(/[+/]/); // the fixture really exercises both symbols
    const url = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect([...urlBase64ToUint8Array(url)]).toEqual(bytes);
  });
  it('turns a VAPID public key (as scripts/vapid-keys.mjs prints it) into the 65-byte raw P-256 point', async () => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey));
    const printed = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const out = urlBase64ToUint8Array(printed);
    expect(out.length).toBe(65);
    expect(out[0]).toBe(0x04);
    expect(Buffer.from(out).equals(raw)).toBe(true);
  });
});
