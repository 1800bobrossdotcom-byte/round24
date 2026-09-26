// ============================================================
// Edge Function: unsubscribe — one-click opt-out from the email footer.
// Public (verify_jwt = false): the link is clicked straight from an inbox,
// no session. Records the address in email_unsub via the service role and
// returns a small branded confirmation page. GET (link click) is the happy
// path; POST is accepted too for List-Unsubscribe-Post one-click.
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET') || SERVICE;
const APP = 'https://round24.app';

// verify the HMAC token minted by the email function — only links WE sent can
// suppress an address, so no one can unsubscribe an arbitrary third party.
async function validToken(email: string, t: string): Promise<boolean> {
  if (!t) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(UNSUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.trim().toLowerCase()));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (expected.length !== t.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ t.charCodeAt(i);
  return diff === 0;
}

const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function page(title: string, msg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Round24</title></head>
  <body style="margin:0;background:#e9e9e9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
    <div style="max-width:520px;margin:12vh auto;padding:0 16px;text-align:center">
      <div style="background:#fff;border:1px solid #0a0a0a;border-radius:0;padding:34px 28px">
        <div style="font-weight:800;font-size:18px;letter-spacing:.14em;text-transform:uppercase">Round24</div>
        <div style="font-size:11px;color:#6b6b6b;letter-spacing:.12em;text-transform:uppercase;margin-top:2px">around the clock</div>
        <h1 style="font-size:20px;margin:22px 0 8px">${esc(title)}</h1>
        <p style="font-size:15px;line-height:1.6;color:#3a3a3a;margin:0 0 20px">${msg}</p>
        <a href="${APP}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:11px 22px;border-radius:0">Back to Round24</a>
      </div>
      <div style="color:#6b6b6b;font-size:12px;margin-top:16px">Round24 · Evolution24 Property Management · Rochester, NY</div>
    </div>
  </body></html>`;
}
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let email = url.searchParams.get('email') || '';
    const t = url.searchParams.get('t') || '';
    if (!email && req.method === 'POST') {
      const ct = req.headers.get('content-type') || '';
      if (ct.includes('application/json')) email = ((await req.json().catch(() => ({}))).email) || '';
      else { const f = await req.formData().catch(() => null); email = (f?.get('email') as string) || ''; }
    }
    email = email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return html(page('That link looks off', 'We couldn’t read an email address from this link. If you keep getting mail you don’t want, reach out and we’ll sort it out.'), 400);
    }
    // the address must carry a valid signature from a link we actually sent
    if (!(await validToken(email, t))) {
      return html(page('That link looks off', 'This unsubscribe link is missing or invalid. Please use the link from a Round24 email, or reach out and we’ll sort it out.'), 400);
    }
    const svc = createClient(SUPA_URL, SERVICE);
    await svc.from('email_unsub').upsert({ email }, { onConflict: 'email' });
    return html(page('You’re unsubscribed', `<b>${esc(email)}</b> won’t receive non-essential email from Round24 anymore. You’ll still get security and account notices tied to your account. Changed your mind? Reach out and we’ll turn it back on.`));
  } catch (_e) {
    return html(page('Something went wrong', 'We hit a snag recording that. Please try the link again in a moment.'), 500);
  }
});
