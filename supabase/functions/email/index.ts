// ============================================================
// Edge Function: email — transactional mail via Resend.
//   type 'welcome' → the CALLER's own address, once per user (user_settings.
//                    data.welcomedAt makes it idempotent); persona tunes the copy
//   type 'invite'  → the branded invitation for an invites.code; allowed for a
//                    platform admin or an admin/manager of the invite's own org
// Honors the email_unsub list for ALL mail. One-click unsubscribe links are
// HMAC-signed (UNSUB_SECRET) so no one can suppress an arbitrary address, and
// RFC 8058 List-Unsubscribe headers are set for bulk-sender compliance.
// Degrades gracefully: with no RESEND_API_KEY it returns
// { ok:false, reason:'not_configured' } (200) so the app flow never breaks.
// Secrets: RESEND_API_KEY, EMAIL_FROM, UNSUB_SECRET, EMAIL_POSTAL (all optional
// but EMAIL_POSTAL should be your real street address for CAN-SPAM).
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('EMAIL_FROM') || 'Round24 <onboarding@resend.dev>';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET') || SERVICE; // signs one-click unsubscribe links
// CAN-SPAM requires a valid physical postal address — set EMAIL_POSTAL to the real street address.
const POSTAL = Deno.env.get('EMAIL_POSTAL') || 'Evolution24 Property Management, Rochester, NY';
const APP = 'https://round24.app';

// CORS: reflect only the app's own origins (audit S5) — never '*'. Re-bound per
// request in the handler; a concurrent re-bind can only swap one allowlisted
// origin for another, so it stays safe.
const CORS_ORIGINS = ['https://round24.app', 'https://www.round24.app', 'https://round24.com', 'https://www.round24.com', 'https://round24.vercel.app', 'https://caliper.solutions', 'https://www.caliper.solutions', 'http://localhost:5173', 'http://localhost:4173'];
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0],
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
let CORS = corsFor(null);
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// HMAC-sign an email so the public unsubscribe endpoint can verify the link
// came from us — prevents anyone from suppressing an arbitrary address.
async function unsubToken(email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(UNSUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const unsubLink = async (to: string) =>
  `${SUPA_URL}/functions/v1/unsubscribe?email=${encodeURIComponent(to)}&t=${await unsubToken(to)}`;

// the Round24 mail shell: black masthead, white body, one black button — the
// same system as supabase/templates/*.html so every email looks like one product
function shell(bodyHtml: string, unsub: string) {
  return `<!doctype html><html><body style="margin:0;background:#e9e9e9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e9e9;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #0a0a0a">
        <tr><td style="background:#050505;padding:18px 26px">
          <span style="font-weight:800;font-size:18px;letter-spacing:.14em;color:#ffffff;text-transform:uppercase">Round24</span>
          <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;color:#9a9a9a;letter-spacing:.16em;text-transform:uppercase;margin-left:10px">around the clock</span>
        </td></tr>
        <tr><td style="padding:22px 26px 26px">${bodyHtml}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td style="padding:14px 26px;color:#6b6b6b;font-size:11.5px;line-height:1.8;text-align:center">
          <a href="${APP}" style="color:#3a3a3a;text-decoration:none">Account settings</a> &nbsp;·&nbsp;
          <a href="${APP}/legal/privacy.html" style="color:#3a3a3a;text-decoration:none">Privacy Policy</a> &nbsp;·&nbsp;
          <a href="${APP}/legal/terms.html" style="color:#3a3a3a;text-decoration:none">Terms</a> &nbsp;·&nbsp;
          <a href="${esc(unsub)}" style="color:#3a3a3a;text-decoration:none">Unsubscribe</a>
          <div style="margin-top:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Round24 · ${esc(POSTAL)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.1em;text-transform:uppercase;padding:13px 22px;border:1px solid #0a0a0a">${label}</a>`;
const h1 = (s: string) => `<h1 style="font-size:22px;line-height:1.2;margin:0 0 10px;color:#0a0a0a;text-transform:uppercase;letter-spacing:.02em">${s}</h1>`;
const p = (s: string) => `<p style="font-size:15px;line-height:1.6;color:#3a3a3a;margin:0 0 12px">${s}</p>`;
const small = (s: string) => `<p style="font-size:12.5px;line-height:1.6;color:#6b6b6b;margin:0">${s}</p>`;
const ROLE_WORD: Record<string, string> = { admin: 'an office admin', manager: 'an office manager', tech: 'crew', viewer: 'a viewer' };

function render(type: string, v: { name?: string; code?: string; orgName?: string; role?: string; persona?: string; newWorkspace?: boolean; unsub: string }) {
  const hi = v.name ? `Hi ${esc(v.name.split(' ')[0])},` : 'Hi there,';
  if (type === 'invite') {
    const link = `${APP}/?invite=${encodeURIComponent(v.code || '')}`;
    const where = v.orgName ? `<b>${esc(v.orgName)}</b>` : 'your workspace';
    const body = v.newWorkspace
      ? p(`Your workspace ${where} is ready. Create your account through the button below and you’ll land inside as the admin.`)
      : p(`You’ve been invited to join ${where} on Round24 as ${ROLE_WORD[v.role || ''] || 'a member'}. Create your account through the button below and you’ll land inside the team’s workspace.`);
    return shell(`${h1(v.newWorkspace ? 'Your workspace is ready' : 'You’ve been invited')}${p(hi)}${body}
      <p style="margin:18px 0">${button(link, 'Create your account')}</p>
      ${small(`If the button doesn’t work, paste this link into your browser:<br><span style="color:#3a3a3a;word-break:break-all">${esc(link)}</span><br><br>The invitation expires in 14 days. Not expecting it? Ignore this email and nothing is created.`)}`, v.unsub);
  }
  // welcome: the first time this person lands inside a workspace
  const first = v.persona === 'crew'
    ? 'Open <b>Field</b> on your phone to start the clock on a job, snap receipts as you go, and say “Round 24, start job” to run it hands-free. Your hours land on the right building automatically.'
    : v.persona === 'resident'
    ? 'From your home page you can report a repair with a photo, follow it to done, book amenities, and reach your building’s office. Add Round24 to your Home Screen to get updates as they happen.'
    : 'A few things to do first: import your rent roll and pay logs from <b>Import</b>, add your team from <b>Access</b>, and watch the per-door P&amp;L fill in as the crew clocks hours. Your profile and security live under <b>Settings</b>.';
  return shell(`${h1('Welcome to Round24')}${p(hi)}
    ${p('Your account is set up. Round24 keeps every hour, receipt and door in one connected, encrypted ledger — around the clock.')}
    <p style="margin:18px 0">${button(APP, 'Open Round24')}</p>
    ${small(first)}`, v.unsub);
}

Deno.serve(async (req) => {
  CORS = corsFor(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const supa = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const type = body.type;
    const svc = createClient(SUPA_URL, SERVICE);
    let to = '', name = body.name as string | undefined, code, orgName, role, newWorkspace = false;
    let persona: string | undefined, settingsData: Record<string, unknown> | null = null;

    if (type === 'welcome') {
      to = user.email || '';
      persona = ['office', 'crew', 'resident'].includes(body.persona) ? body.persona : 'office';
      // once per person, ever — whichever device or session asks first
      const { data: us } = await svc.from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
      settingsData = (us?.data as Record<string, unknown>) || {};
      if (settingsData.welcomedAt) return json({ ok: true, skipped: 'already welcomed' });
      if (!name && typeof settingsData.displayName === 'string') name = settingsData.displayName as string;
    } else if (type === 'invite') {
      code = String(body.code || '').trim().toUpperCase();
      if (!code) return json({ error: 'no code' }, 400);
      const { data: inv } = await svc.from('invites').select('org_id, email, role, label, used_at, expires_at').eq('code', code).maybeSingle();
      if (!inv) return json({ error: 'invite not found' }, 404);
      if (inv.used_at) return json({ error: 'invite already used' }, 409);
      // a platform admin may mail any invite; an org admin/manager only their own org's
      const { data: isAdmin } = await supa.rpc('is_platform_admin');
      if (!isAdmin) {
        const { data: m } = await svc.from('memberships').select('role').eq('org_id', inv.org_id).eq('user_id', user.id).maybeSingle();
        if (!m || !['admin', 'manager'].includes(m.role)) return json({ error: 'not authorized' }, 403);
      } else newWorkspace = inv.role === 'admin' && !!body.orgName;   // platform-created workspace invite
      to = inv.email || body.to; role = inv.role; name = name || inv.label || undefined;
      if (!to) return json({ error: 'no recipient' }, 400);
      const { data: org } = await svc.from('orgs').select('name').eq('id', inv.org_id).maybeSingle();
      orgName = org?.name || body.orgName;
    } else {
      return json({ error: 'unknown type' }, 400);
    }
    if (!to) return json({ ok: true, skipped: 'no address' });

    const { data: unsubbed } = await svc.from('email_unsub').select('email').eq('email', to.toLowerCase()).maybeSingle();
    if (unsubbed) return json({ ok: true, skipped: 'unsubscribed' }); // honored for every type

    if (!RESEND) return json({ ok: false, reason: 'not_configured' });

    const unsub = await unsubLink(to);
    const subject = type === 'invite'
      ? (newWorkspace ? 'Your Round24 workspace is ready' : `You’re invited to ${orgName || 'a workspace'} on Round24`)
      : 'Welcome to Round24';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [to], subject, html: render(type, { name, code, orgName, role, persona, newWorkspace, unsub }),
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!r.ok) return json({ ok: false, error: 'send failed' }, 502);
    if (type === 'welcome') {
      await svc.from('user_settings').upsert({ user_id: user.id, data: { ...(settingsData || {}), welcomedAt: new Date().toISOString() } }, { onConflict: 'user_id' });
    }
    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'internal error' }, 500);
  }
});
