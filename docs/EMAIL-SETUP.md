# Round24 — email setup (reset, welcome, invites)

Three kinds of mail leave Round24, from two senders:

| Mail | Trigger | Sent by |
|---|---|---|
| **Password reset** | Sign in → *Forgot password?* | Supabase Auth, using `supabase/templates/recovery.html` |
| **Account confirmation / magic link / email change** | Only if you turn those on in Auth settings | Supabase Auth, same template set |
| **Welcome** | The first time a person lands inside a workspace (a seat or a residency), once per person | `email` edge function via Resend |
| **Invitation** | Access → *Invite someone* with an email filled in, or a platform-approved workspace | `email` edge function via Resend |

Everything below is one-time setup. The code is already in the repo.

## 1. Branded Supabase auth emails

The templates live in `supabase/templates/` and are wired up in
`supabase/config.toml` (subjects, redirect URLs, site URL). Push them to the
project with the CLI — it shows a diff and asks before applying:

```bash
supabase link --project-ref lwijercxiobdwqxvnwyy
supabase config push
```

No CLI handy? Dashboard → Authentication → Email Templates, then for each
template paste the file's HTML and set the subject:

| Dashboard template | File | Subject |
|---|---|---|
| Reset password | `recovery.html` | Reset your Round24 password |
| Confirm signup | `confirmation.html` | Confirm your Round24 account |
| Invite user | `invite.html` | You’ve been invited to Round24 |
| Magic link | `magic_link.html` | Your Round24 sign-in link |
| Change email address | `email_change.html` | Confirm your new Round24 email |
| Reauthentication | `reauthentication.html` | Your Round24 verification code |

And under Authentication → URL Configuration set the Site URL to
`https://round24.app` and add these redirect URLs:
`https://round24.app/**`, `https://www.round24.app/**`, `https://round24.vercel.app/**`,
`http://localhost:5173/**`. The reset link returns to `/?reset=1`, which is
what opens the set-a-new-password screen.

## 2. Send auth mail from your own domain

Out of the box Supabase sends auth mail from its shared sender at a few
messages per hour — fine for testing, not for a team. Point it at Resend:

1. In Resend, add and verify `round24.app` (the DNS records it shows).
2. Dashboard → Authentication → SMTP Settings → enable custom SMTP:
   host `smtp.resend.com`, port `465`, user `resend`, password = your Resend
   API key, sender `Round24 <hello@round24.app>`.

## 3. The welcome + invite sender

The `email` function needs its secrets (Dashboard → Edge Functions → Secrets):

```bash
supabase secrets set RESEND_API_KEY=re_... \
  EMAIL_FROM='Round24 <hello@round24.app>' \
  EMAIL_POSTAL='Your Company, 123 Main St, Rochester, NY 14604' \
  UNSUB_SECRET="$(openssl rand -hex 32)"
supabase functions deploy email unsubscribe
```

Until `RESEND_API_KEY` is set the function answers `not_configured` and the
app carries on: invites still show their link to copy, and nothing else breaks.

## How it behaves

- **Reset**: the sign-in form always says "if an account exists, a link is on
  its way", so addresses can't be probed. Links work once and expire in an
  hour; an expired link lands on sign-in with a note to request a new one.
- **Welcome**: fires when someone first lands in a workspace, on any device,
  and never twice — the function records `welcomedAt` in their settings.
  The copy differs for office, crew and residents.
- **Invitation**: an org admin or manager can only mail invites for their own
  workspace; the function checks the invite's org against their membership.
  Platform-created workspace invites keep the "your workspace is ready" copy.
- Every Resend mail honors the unsubscribe list and carries one-click
  unsubscribe headers; auth mail (reset, confirmation) is transactional and
  always delivered.
