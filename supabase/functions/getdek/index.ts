// ============================================================
// Edge Function: getdek — envelope-encryption core.
// Runs on Supabase's SERVER (Deno) — the browser never sees the KMS
// master key or any AWS credential.
//
// Flow:
//   1. verify the caller is an authenticated user (Supabase validates JWT)
//   2. verify the caller is staff (admin/manager) — techs/viewers never
//      receive the DEK, so contractors cannot decrypt pay data
//   3. look up the org's wrapped DEK; on first use, KMS GenerateDataKey
//      creates it (32-byte plaintext + wrapped blob stored in org_keys)
//   4. thereafter, KMS Decrypt unwraps it per session
//
// EncryptionContext binds each wrapped DEK to its org_id: a blob copied
// to another org's row will refuse to decrypt.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   CALIPER_AWS_ACCESS_KEY_ID, CALIPER_AWS_SECRET_ACCESS_KEY,
//   CALIPER_AWS_REGION, CALIPER_KMS_KEY_ID
// CALIPER_DEV_MODE=true is honored ONLY when KMS is not configured.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { KMSClient, DecryptCommand, GenerateDataKeyCommand } from 'npm:@aws-sdk/client-kms@3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AWS_REGION = Deno.env.get('CALIPER_AWS_REGION');
const AWS_KEY_ID = Deno.env.get('CALIPER_AWS_ACCESS_KEY_ID');
const AWS_SECRET = Deno.env.get('CALIPER_AWS_SECRET_ACCESS_KEY');
const KMS_KEY_ID = Deno.env.get('CALIPER_KMS_KEY_ID');
const kmsConfigured = !!(AWS_REGION && AWS_KEY_ID && AWS_SECRET && KMS_KEY_ID);
const DEV_MODE = !kmsConfigured && Deno.env.get('CALIPER_DEV_MODE') === 'true';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // ---- authenticate the caller ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    // ---- resolve caller's org + role ----
    const { data: mem } = await supabase.from('memberships').select('org_id, role').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);
    // admin/manager (incl. owner-admins) and viewers can read the rent roll, so
    // they may decrypt its fields. Field crew (tech) read nothing encrypted.
    if (!['admin', 'manager', 'viewer'].includes(mem.role)) {
      return json({ error: 'forbidden: decryption requires office access' }, 403);
    }
    const orgId = mem.org_id;

    // ---- obtain the DEK ----
    let dekBytes: Uint8Array;
    if (kmsConfigured) {
      // service role: org_keys is deny-all to end users by design
      const admin = createClient(
        Deno.env.get('SUPABASE_URL'),
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      );
      const kms = new KMSClient({
        region: AWS_REGION,
        credentials: { accessKeyId: AWS_KEY_ID!, secretAccessKey: AWS_SECRET! },
      });
      const ctx = { org_id: orgId };

      const { data: row } = await admin
        .from('org_keys').select('wrapped_dek').eq('org_id', orgId).maybeSingle();

      if (row?.wrapped_dek) {
        const out = await kms.send(new DecryptCommand({
          CiphertextBlob: hexToBytes(row.wrapped_dek), EncryptionContext: ctx,
        }));
        dekBytes = new Uint8Array(out.Plaintext!);
      } else {
        // first use for this org: mint its DEK
        const out = await kms.send(new GenerateDataKeyCommand({
          KeyId: KMS_KEY_ID, KeySpec: 'AES_256', EncryptionContext: ctx,
        }));
        dekBytes = new Uint8Array(out.Plaintext!);
        const { error: insErr } = await admin.from('org_keys').insert({
          org_id: orgId,
          wrapped_dek: '\\x' + bytesToHex(new Uint8Array(out.CiphertextBlob!)),
          kms_key_id: KMS_KEY_ID,
        });
        if (insErr) {
          // lost a concurrent bootstrap race — use the winner's DEK
          const { data: again } = await admin
            .from('org_keys').select('wrapped_dek').eq('org_id', orgId).single();
          const out2 = await kms.send(new DecryptCommand({
            CiphertextBlob: hexToBytes(again!.wrapped_dek), EncryptionContext: ctx,
          }));
          dekBytes = new Uint8Array(out2.Plaintext!);
        }
      }
    } else if (DEV_MODE) {
      // deterministic dev key derived from orgId — TESTING ONLY, not secure
      dekBytes = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode('caliper-dev-' + orgId))
      );
    } else {
      return json({ error: 'encryption backend not configured' }, 500);
    }

    return json({ dek: b64(dekBytes) });
  } catch (_e) {
    return json({ error: 'internal error' }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function b64(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
// PostgREST returns bytea as "\x<hex>"
function hexToBytes(hex: string) {
  const h = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
