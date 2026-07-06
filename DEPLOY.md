# Getting Caliper online — the simple version

You don't need to understand any of this. Just follow along. If anything goes
wrong, the helper tells you exactly what to do, and you can always copy the
error text and send it to Claude.

---

## The one command

1. **Unzip** `caliper-app.zip`. You'll get a folder called `caliper`.
2. **Open a terminal** in that folder:
   - **Mac:** right-click the `caliper` folder → *New Terminal at Folder*.
   - **Windows:** open the folder, click the address bar, type `cmd`, press Enter.
3. **Type this and press Enter:**
   ```
   bash deploy.sh
   ```
4. **Follow the prompts.** It checks everything, installs what's missing, and
   walks you to a live website. When it asks a question, the safe answer is
   usually just pressing Enter.

That's the whole thing.

---

## What the helper does for you (so nothing feels mysterious)

- Checks that Node.js is installed — and if not, tells you the one link to get it.
- Installs the app's parts (`npm install`).
- Does a test build to confirm the app is healthy.
- Offers to deploy with Vercel (free), opening a browser to log you in.
- Deploys a private preview first, then asks before making it public.
- Finishes with the exact steps to connect **caliper.solutions**.

It never deletes anything and asks before each big step.

---

## If it stops with a red ✗

That's the helper protecting you, not a disaster. It prints the reason in plain
words. The three usual ones:

- **"Node.js isn't installed"** → go to https://nodejs.org, click the green
  **LTS** button, install, reopen the terminal, run `bash deploy.sh` again.
- **"npm install failed"** → almost always internet. Check wifi, or try a
  different network (some office/school networks block it), then rerun.
- **"The build hit an error"** → copy the red text, send it to Claude, get the
  exact one-line fix.

---

## Connecting caliper.solutions (the last 2 minutes)

After the site is live on a `.vercel.app` address:

1. Go to **vercel.com** → your project → **Settings → Domains**.
2. Add **caliper.solutions**.
3. In **Namecheap** → your domain → **Advanced DNS**, add:

   | Type | Host | Value |
   |------|------|-------|
   | A Record | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com.` |

   *(If Vercel shows a different number than `76.76.21.21`, use Vercel's.)*
4. Turn **OFF** Namecheap's *Domain Parking* if it's switched on.
5. Wait a few minutes. The padlock (secure https) turns on automatically.

Done — caliper.solutions is live.
