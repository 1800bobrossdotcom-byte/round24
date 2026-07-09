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
const APP = 'https://caliper.solutions';

const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function page(title: string, msg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Caliper</title></head>
  <body style="margin:0;background:#f4f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14171a">
    <div style="max-width:520px;margin:12vh auto;padding:0 16px;text-align:center">
      <div style="background:#fff;border:1px solid #e0e2db;border-radius:16px;padding:34px 28px">
        <div style="font-weight:800;font-size:22px;letter-spacing:-.01em">Caliper</div>
        <div style="font-size:11px;color:#8b929b;letter-spacing:.12em;text-transform:uppercase;margin-top:2px">labor, measured true</div>
        <h1 style="font-size:20px;margin:22px 0 8px">${esc(title)}</h1>
        <p style="font-size:15px;line-height:1.6;color:#3a4048;margin:0 0 20px">${msg}</p>
        <a href="${APP}" style="display:inline-block;background:#14171a;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:11px 22px;border-radius:10px">Back to Caliper</a>
      </div>
      <div style="color:#8b929b;font-size:12px;margin-top:16px">Caliper · Evolution24 Property Management · Rochester, NY</div>
    </div>
  </body></html>`;
}
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let email = url.searchParams.get('email') || '';
    if (!email && req.method === 'POST') {
      const ct = req.headers.get('content-type') || '';
      if (ct.includes('application/json')) email = ((await req.json().catch(() => ({}))).email) || '';
      else { const f = await req.formData().catch(() => null); email = (f?.get('email') as string) || ''; }
    }
    email = email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return html(page('That link looks off', 'We couldn’t read an email address from this link. If you keep getting mail you don’t want, reach out and we’ll sort it out.'), 400);
    }
    const svc = createClient(SUPA_URL, SERVICE);
    await svc.from('email_unsub').upsert({ email }, { onConflict: 'email' });
    return html(page('You’re unsubscribed', `<b>${esc(email)}</b> won’t receive non-essential email from Caliper anymore. You’ll still get security and account notices tied to your account. Changed your mind? You can re-enable email anytime in Settings.`));
  } catch (_e) {
    return html(page('Something went wrong', 'We hit a snag recording that. Please try the link again in a moment.'), 500);
  }
});
