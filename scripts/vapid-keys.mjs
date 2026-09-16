#!/usr/bin/env node
// Generate the VAPID key pair for Caliper Web Push. Run ONCE per environment:
//
//   node scripts/vapid-keys.mjs
//
// It prints two values:
//   VITE_VAPID_PUBLIC_KEY  → Vercel env var (public; the browser needs it to subscribe)
//   VAPID_KEYS_JSON        → Supabase secret for the push-send function (PRIVATE — never commit)
//
// Rotating the pair invalidates every existing device subscription (people
// re-enable from the bell), so keep the private half safe rather than regenerating.
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = async (key) => { const j = await subtle.exportKey('jwk', key); delete j.key_ops; delete j.ext; return j; };
const publicKey = await jwk(keys.publicKey);
const privateKey = await jwk(keys.privateKey);
const raw = Buffer.from(await subtle.exportKey('raw', keys.publicKey));
const applicationServerKey = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('\nVITE_VAPID_PUBLIC_KEY  (Vercel → Environment Variables; public):\n');
console.log(applicationServerKey);
console.log('\nVAPID_KEYS_JSON  (Supabase → Edge Functions → Secrets; PRIVATE):\n');
console.log(JSON.stringify({ publicKey, privateKey }));
console.log('');
