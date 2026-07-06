# Caliper — backend setup (auth + encryption)

This turns Caliper from a demo into a real, secure app: real logins,
per-tenant data isolation, and AES-256 encryption of sensitive fields.

The app is built so it **still runs in demo mode** (sample data, no login)
until you complete these steps — so nothing breaks while you set up.

---

## What you're setting up

- **Supabase** — free managed Postgres database + authentication
- **Row-Level Security** — each org only ever sees its own data (enforced by the database)
- **AES-256-GCM encryption** — pay rates, names, and RM credentials stored as ciphertext
- **AWS KMS** (later) — holds the master key; per-tenant keys enable "delete = shred"

---

## Step 1 — Create a Supabase project (~5 min)

1. Go to **supabase.com** → sign up (free) → **New Project**
2. Name it `caliper`, set a database password (save it), pick a region near you
3. Wait for it to finish provisioning

## Step 2 — Create the tables

1. In Supabase → **SQL Editor** → **New query**
2. Open `supabase/migrations/0001_init.sql` from this project, copy all of it
3. Paste into the SQL editor → **Run**
4. You should see "Success" — this creates the tables, RLS policies, and indexes

## Step 3 — Connect the app to Supabase

1. In Supabase → **Project Settings** → **API**
2. Copy the **Project URL** and the **anon public** key
3. In **Vercel** → your project → **Settings** → **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Redeploy (Vercel → Deployments → ⋯ → Redeploy, or just push a commit)

The app will now show a **login screen** instead of demo mode.

## Step 4 — Make your first user + org

1. In Supabase → **Authentication** → **Users** → **Add user** (your email + a password)
2. In **SQL Editor**, create your org and membership (replace the email):
   ```sql
   insert into orgs (name, slug) values ('Evolution24 Property Management','evolution24')
     returning id;
   -- copy the returned id, then:
   insert into memberships (org_id, user_id, role)
   select '<ORG_ID_FROM_ABOVE>', id, 'admin'
   from auth.users where email = 'you@example.com';
   ```
3. Now sign in on the live site with that email + password. You're through the gate.

## Step 5 — Turn on encryption (the DEK function)

The app fetches its encryption key from a server function so the key never
ships to the browser. For now, to test encryption end-to-end:

1. Install the Supabase CLI (supabase.com/docs/guides/cli), or use the dashboard
2. Deploy the function in `supabase/functions/getdek/`
3. Set a temporary secret to test:  `CALIPER_DEV_MODE=true`
   - ⚠️ DEV_MODE uses a test key — fine for verifying the flow, **never leave it on in production**
4. Later: wire **AWS KMS** (store each org's wrapped key, swap the DEV_MODE branch
   for a real KMS `Decrypt` call). That's the production-grade envelope encryption
   from the spec. Until then, encryption works with the dev key so you can build.

---

## Security notes (plain English)

- The **anon key is safe** in the browser — it's not a password. Row-Level
  Security is what actually protects data: the database itself refuses to return
  another org's rows.
- **Sensitive fields are encrypted before they hit the database.** Even someone
  with full database access sees only ciphertext for rates, names, and credentials.
- **Fail-closed:** if the encryption key can't be reached, the app errors rather
  than showing unprotected data. (Verified: tampered or wrong-key data is rejected.)
- **Don't commit** `VITE_SUPABASE_*` values or AWS keys to GitHub — they live in
  Vercel/Supabase environment settings only.
