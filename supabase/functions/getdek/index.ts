// ============================================================
// Edge Function: getdek
// Runs on Supabase's SERVER (Deno) — the browser never sees the KMS
// master key. This is the envelope-encryption core from the spec.
//
// Flow:
//   1. verify the caller is an authenticated user (Supabase validates JWT)
//   2. look up the caller's org
//   3. unwrap that org's encrypted DEK using AWS KMS (per-tenant key)
//   4. return the plaintext 32-byte DEK (base64) for this session only
//
// The wrapped (encrypted) DEK is stored per-org; KMS holds the master key
// that can unwrap it. Offboard a tenant = schedule their KMS key for
// deletion = their data is cryptographically shredded.
//
// NOTE: this is the production shape. To run it you set these secrets in
// Supabase (Project Settings → Edge Functions → Secrets):
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
// and store each org's wrapped DEK. Until KMS is wired, DEV_MODE returns a
// deterministic dev key so the app is testable — NEVER enable DEV_MODE in prod.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DEV_MODE = Deno.env.get('CALIPER_DEV_MODE') === 'true'; // must be false in prod

Deno.serve(async (req) => {
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

    // ---- resolve caller's org ----
    const { data: mem } = await supabase.from('memberships').select('org_id').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);
    const orgId = mem.org_id;

    // ---- obtain the DEK ----
    let dekBytes;
    if (DEV_MODE) {
      // deterministic dev key derived from orgId — TESTING ONLY, not secure
      dekBytes = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode('caliper-dev-' + orgId))
      );
    } else {
      // PRODUCTION: unwrap the org's wrapped DEK via AWS KMS.
      // pseudo — wire with an AWS SDK / KMS Decrypt call:
      //   const wrapped = await getWrappedDEKForOrg(orgId);      // from db
      //   dekBytes = await kmsDecrypt(wrapped, { EncryptionContext: { org_id: orgId } });
      throw new Error('KMS unwrap not yet configured — set up AWS KMS and store wrapped DEKs, or enable CALIPER_DEV_MODE for testing');
    }

    return json({ dek: b64(dekBytes) });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function b64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
