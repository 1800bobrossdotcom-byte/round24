// ============================================================
// Edge Function: email — transactional mail via Resend.
//   type 'welcome' → sends to the CALLER's own address (post-signup)
//   type 'invite'  → platform-admin only; sends an invite to a recipient
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
const FROM = Deno.env.get('EMAIL_FROM') || 'Caliper <onboarding@resend.dev>';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET') || SERVICE; // signs one-click unsubscribe links
// CAN-SPAM requires a valid physical postal address — set EMAIL_POSTAL to the real street address.
const POSTAL = Deno.env.get('EMAIL_POSTAL') || 'Evolution24 Property Management, Rochester, NY';
const APP = 'https://caliper.solutions';

// CORS: reflect only the app's own origins (audit S5) — never '*'. Re-bound per
// request in the handler; a concurrent re-bind can only swap one allowlisted
// origin for another, so it stays safe.
const CORS_ORIGINS = ['https://caliper.solutions', 'https://www.caliper.solutions', 'http://localhost:5173', 'http://localhost:4173'];
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

function shell(bodyHtml: string, unsub: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14171a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f2;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e0e2db;border-radius:16px;overflow:hidden">
        <tr><td style="padding:22px 26px 6px">
          <span style="font-weight:800;font-size:20px;letter-spacing:-.01em;color:#14171a">Caliper</span>
          <span style="font-size:11px;color:#8b929b;letter-spacing:.12em;text-transform:uppercase;margin-left:6px">labor, measured true</span>
        </td></tr>
        <tr><td style="padding:8px 26px 24px">${bodyHtml}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td style="padding:16px 26px;color:#8b929b;font-size:12px;line-height:1.7;text-align:center">
          <a href="${APP}" style="color:#586069;text-decoration:none">Account settings</a> &nbsp;·&nbsp;
          <a href="${APP}/legal/privacy.html" style="color:#586069;text-decoration:none">Privacy Policy</a> &nbsp;·&nbsp;
          <a href="${APP}/legal/terms.html" style="color:#586069;text-decoration:none">Terms</a> &nbsp;·&nbsp;
          <a href="${esc(unsub)}" style="color:#586069;text-decoration:none">Unsubscribe</a>
          <div style="margin-top:8px">Caliper · ${esc(POSTAL)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#14171a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">${label}</a>`;

function render(type: string, v: { name?: string; code?: string; orgName?: string; unsub: string }) {
  const hi = v.name ? `Hi ${esc(v.name.split(' ')[0])},` : 'Hi there,';
  if (type === 'invite') {
    const link = `${APP}/?invite=${encodeURIComponent(v.code || '')}`;
    return shell(`
      <h1 style="font-size:22px;margin:12px 0 8px;color:#14171a">You’re in — welcome to Caliper</h1>
      <p style="font-size:15px;line-height:1.6;color:#3a4048;margin:0 0 8px">${hi}</p>
      <p style="font-size:15px;line-height:1.6;color:#3a4048;margin:0 0 18px">Your workspace${v.orgName ? ` <b>${esc(v.orgName)}</b>` : ''} is ready. Create your account through the button below and you’ll land inside as the admin.</p>
      <p style="margin:0 0 18px">${button(link, 'Create your account')}</p>
      <p style="font-size:12.5px;line-height:1.6;color:#8b929b;margin:0">If the button doesn’t work, paste this link: <br><span style="color:#586069">${esc(link)}</span></p>`, v.unsub);
  }
  return shell(`
    <h1 style="font-size:22px;margin:12px 0 8px;color:#14171a">Welcome to Caliper</h1>
    <p style="font-size:15px;line-height:1.6;color:#3a4048;margin:0 0 8px">${hi}</p>
    <p style="font-size:15px;line-height:1.6;color:#3a4048;margin:0 0 18px">Your account is set up. Caliper puts your properties, leases, work orders and expenses in one place — the spreadsheet, replaced. Jump in whenever you’re ready.</p>
    <p style="margin:0 0 18px">${button(APP, 'Open Caliper')}</p>
    <p style="font-size:13px;line-height:1.7;color:#586069;margin:0">A few things you can do first: import your rent roll, set lease renewal reminders, and add your team from <b>Access</b>. Manage your profile and security anytime under <b>Settings</b>.</p>`, v.unsub);
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
    let to = '', name = body.name as string | undefined, code, orgName;

    if (type === 'welcome') {
      to = user.email || '';
    } else if (type === 'invite') {
      const { data: isAdmin } = await supa.rpc('is_platform_admin');
      if (!isAdmin) return json({ error: 'not authorized' }, 403);
      to = body.to; code = body.code; orgName = body.orgName;
      if (!to) return json({ error: 'no recipient' }, 400);
    } else {
      return json({ error: 'unknown type' }, 400);
    }
    if (!to) return json({ ok: true, skipped: 'no address' });

    const svc = createClient(SUPA_URL, SERVICE);
    const { data: unsubbed } = await svc.from('email_unsub').select('email').eq('email', to.toLowerCase()).maybeSingle();
    if (unsubbed) return json({ ok: true, skipped: 'unsubscribed' }); // honored for every type

    if (!RESEND) return json({ ok: false, reason: 'not_configured' });

    const unsub = await unsubLink(to);
    const subject = type === 'invite' ? 'Your Caliper workspace is ready' : 'Welcome to Caliper';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [to], subject, html: render(type, { name, code, orgName, unsub }),
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!r.ok) return json({ ok: false, error: 'send failed' }, 502);
    return json({ ok: true });
  } catch (_e) {
    return json({ error: 'internal error' }, 500);
  }
});
