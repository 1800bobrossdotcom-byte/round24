# Caliper — Web Push setup (one-time, ~10 minutes)

What this gives you: real system notifications on phones and desktops **even
when Caliper is closed** — new and urgent work orders, assignments, receipts to
review, resident requests, chat. The bell, the in-app feed and toasts already
work without any of this; push is the layer on top for lock screens.

How the pieces fit:

```
phone/desktop  ── Enable ──▶  push_subscriptions (one row per device)
                                       ▲
work_orders / purchases / messages /   │ reads
maintenance_requests  ── trigger ──▶  push-send edge function ──▶ Apple / Google / Mozilla push ──▶ device
   (notify_push, via pg_net)
```

Everything in the repo is already written (`public/sw.js`, `src/lib/push.js`,
`supabase/migrations/0057_web_push.sql`, `supabase/functions/push-send`). The
steps below are the parts only you can do: keys, secrets, deploy.

## Step 1 — Generate the VAPID key pair (once)

```bash
node scripts/vapid-keys.mjs
```

It prints two values:

- `VITE_VAPID_PUBLIC_KEY` — public; goes in Vercel.
- `VAPID_KEYS_JSON` — **private**; goes in Supabase secrets only. Never commit it.

Keep the private half somewhere safe. Regenerating later invalidates every
device subscription (everyone taps Enable again).

## Step 2 — Vercel: the public key

Project → Settings → Environment Variables → add `VITE_VAPID_PUBLIC_KEY` with the
first value, for Production (and Preview if you use it). Then **redeploy** —
`VITE_*` values are baked in at build time.

## Step 3 — Supabase: secrets for the sender

Dashboard → Edge Functions → Secrets, or with the CLI:

```bash
supabase secrets set \
  VAPID_KEYS_JSON='<the JSON line from step 1>' \
  VAPID_SUBJECT='mailto:you@yourdomain.com' \
  PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

- `VAPID_SUBJECT` is a contact address the push services may use if something misbehaves.
- `PUSH_WEBHOOK_SECRET` is any long random string. Keep it — step 6 uses the same value.
- Optional: `APP_URL` (default `https://caliper.solutions`) — where a tapped notification opens.

## Step 4 — Deploy the function

```bash
supabase functions deploy push-send --no-verify-jwt
```

(`supabase/config.toml` already sets `verify_jwt = false` for it: the database
calls this function, not a signed-in person, and it checks the shared secret itself.)

## Step 5 — Run the migrations

SQL editor → paste and run, in order:

1. `supabase/migrations/0056_purchases_realtime.sql` (if you haven't yet — receipts ping the office live)
2. `supabase/migrations/0057_web_push.sql`

If the `create extension pg_net` line is refused, enable **pg_net** under
Database → Extensions and run the file again.

## Step 6 — Tell the database where to send events

SQL editor:

```sql
insert into push_config (key, value) values
  ('url',    'https://lwijercxiobdwqxvnwyy.supabase.co/functions/v1/push-send'),
  ('secret', '<the PUSH_WEBHOOK_SECRET from step 3>')
on conflict (key) do update set value = excluded.value;
```

Until these two rows exist the trigger is a silent no-op, so nothing breaks if
you do steps 5 and 6 in either order.

## Step 7 — Enable on each device

Bell → **Enable notifications** (or Settings → *Notifications on this device*).
Each phone or computer is its own subscription; a person can turn one off from
the same spot without affecting the others.

- **iPhone / iPad**: push only works for web apps on the Home Screen (iOS 16.4+).
  Share → *Add to Home Screen*, open Caliper from that icon, then Enable. In a
  plain Safari tab the control explains this instead of failing.
- **Android** (Chrome, Edge, Firefox, Samsung Internet) and **desktop** browsers: works as-is.

## Check it works

- `select user_id, left(endpoint, 40), created_at from push_subscriptions;` — one row per enabled device.
- Create a work order from a second account → the first phone buzzes within a few seconds.
- Edge Functions → push-send → Logs shows `{"ok":true,"sent":1,...}` per event.
- `select status_code, left(content, 120) from net._http_response order by id desc limit 5;`
  shows the trigger's calls (a `401` means the two secrets don't match).

## Who gets what

| Event | Goes to | Priority |
|---|---|---|
| New work order / field report | Office admins & managers + the assignee | from the order (1 = urgent, 2 = high) |
| Assignee changed | The new assignee | from the order |
| Priority changed | Office + assignee | new priority |
| Started / done | Office | normal |
| Cancelled / reopened | Assignee | normal |
| New resident request | Office | high |
| Receipt submitted | Office | normal |
| Receipt approved / rejected | Whoever submitted it | rejected = high |
| Chat message (all / work-order thread) | Everyone in the org | normal |
| Chat message (DM / group) | That channel's members | normal |

The person who made the change is never pinged about it. Settings → *Work-order
alerts* and *Chat notifications* mute those kinds per person. Urgent jobs stay on
screen until acted on; everything else is a normal banner. When Caliper is
already open and in front, only urgent pushes show a banner — the in-app toast
and feed cover the rest.

## Privacy

The payload is only what the banner shows: task, property and unit, vendor and
amount, sender name and the first ~100 characters of a message. Photos, voice
notes, line items, checklists and resident contact details never leave the
database. Web Push encrypts each message end-to-end to the device, so Apple,
Google and Mozilla relay it without being able to read it.

## Pause, rotate, or undo

- Pause all pushes: `delete from push_config where key = 'url';` (re-insert to resume).
- Rotate the keys: run step 1 again, update Vercel and the secret, redeploy; everyone re-enables.
- One device: bell → **Turn off**. Browser-level permission stays the browser's to change.
