// ============================================================
// field encryption — AES-256-GCM via Web Crypto (standard, audited primitives).
// we do NOT invent crypto; we correctly use the browser/runtime's vetted AES-GCM.
//
// ARCHITECTURE (important):
//   - the data encryption key (DEK) must come from the SERVER, never be
//     hardcoded or shipped in frontend bundle. in production the DEK is
//     fetched per-session from a Supabase Edge Function that unwraps it with
//     AWS KMS (envelope encryption) — see supabase/functions/getdek.
//   - this module only does the local encrypt/decrypt once it HAS a key.
//   - each value gets a fresh random 12-byte IV; GCM auth tag is appended.
//   - ciphertext layout:  [IV (12 bytes)][ciphertext+tag]  → base64.
//   - fail-closed: any decrypt error throws; callers must handle, never
//     silently fall back to plaintext.
// ============================================================

const IV_LEN = 12;

// import a raw 32-byte key (from server) into a non-extractable CryptoKey
export async function importKey(rawKeyBytes) {
  if (!(rawKeyBytes instanceof Uint8Array) || rawKeyBytes.length !== 32) {
    throw new Error('DEK must be 32 bytes (AES-256)');
  }
  return crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// encrypt a string → base64( iv | ciphertext+tag )
export async function encryptField(key, plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const data = new TextEncoder().encode(String(plaintext));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(IV_LEN + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LEN);
  return b64encode(out);
}

// decrypt base64( iv | ciphertext+tag ) → string. throws on tamper/wrong key.
export async function decryptField(key, b64) {
  if (b64 == null) return null;
  const buf = b64decode(b64);
  const iv = buf.slice(0, IV_LEN);
  const ct = buf.slice(IV_LEN);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct); // throws if auth fails
  return new TextDecoder().decode(pt);
}

// convenience: encrypt/decrypt a numeric rate
export const encryptRate = (key, n) => encryptField(key, n == null ? null : String(n));
export const decryptRate = async (key, b64) => {
  const s = await decryptField(key, b64);
  return s == null ? null : Number(s);
};

// ---- base64 helpers (browser + node safe) ----
function b64encode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bytes).toString('base64');
}
function b64decode(str) {
  if (typeof atob !== 'undefined') {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}
