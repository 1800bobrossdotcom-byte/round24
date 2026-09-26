#!/usr/bin/env bash
# One command to apply the Round24 auth + email setup to the Supabase project:
#   auth templates, redirect URLs, custom SMTP  → `supabase config push`
#   the sender's secrets                         → `supabase secrets set`
#   the edge functions                           → `supabase functions deploy`
#
# Needs, in the environment (never on the command line, never committed):
#   SUPABASE_ACCESS_TOKEN  a personal access token (Supabase → Account → Access Tokens)
#   RESEND_API_KEY         the Resend API key (used for SMTP and the email function)
# Optional: EMAIL_FROM (default 'Round24 <hello@round24.app>'), EMAIL_POSTAL, UNSUB_SECRET, PUSH_WEBHOOK_SECRET
set -euo pipefail
cd "$(dirname "$0")/.."
REF="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN in the environment}"
: "${RESEND_API_KEY:?set RESEND_API_KEY in the environment}"

echo "▸ linking to $REF"
npx -y supabase link --project-ref "$REF" >/dev/null

echo "▸ pushing auth config (templates, redirect URLs, SMTP)"
npx -y supabase config push --yes

echo "▸ setting function secrets"
npx -y supabase secrets set \
  RESEND_API_KEY="$RESEND_API_KEY" \
  EMAIL_FROM="${EMAIL_FROM:-Round24 <hello@round24.app>}" \
  ${EMAIL_POSTAL:+EMAIL_POSTAL="$EMAIL_POSTAL"} \
  ${UNSUB_SECRET:+UNSUB_SECRET="$UNSUB_SECRET"} \
  ${PUSH_WEBHOOK_SECRET:+PUSH_WEBHOOK_SECRET="$PUSH_WEBHOOK_SECRET"}

echo "▸ deploying edge functions"
npx -y supabase functions deploy email unsubscribe

echo "✓ done — send yourself a password reset from the sign-in page to confirm"
