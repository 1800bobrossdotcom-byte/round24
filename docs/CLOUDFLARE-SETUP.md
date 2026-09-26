# Round24 on Cloudflare — DNS, mail, and the .com

Today `round24.app` is registered at Namecheap and uses Namecheap's DNS
(`dns1/dns2.registrar-servers.com`), already pointed at Vercel. Moving DNS to
Cloudflare gives you one place for records, free inbound mail routing for
`hello@round24.app`, DNSSEC, and analytics. Hosting stays on Vercel.

## 1. Add the site

Cloudflare dashboard → Add a domain → `round24.app` → Free plan. Cloudflare
scans and imports the current records. Check the two that matter, and set both
to **DNS only** (grey cloud):

| Type | Name | Value |
|---|---|---|
| A | `@` | `216.150.1.1` |
| CNAME | `www` | `fad4174917219ebe.vercel-dns-016.com` |

Vercel terminates TLS itself. Leave these unproxied, or Vercel's certificate
checks fail behind Cloudflare's proxy.

`infra/dns/round24.app.zone` is the same set as a zone file you can import
(DNS → Records → Import and Export), and `scripts/cloudflare-dns.py` applies it
through the API with a `CLOUDFLARE_API_TOKEN` (Zone → DNS → Edit) in the
environment.

## 2. Move the nameservers

Cloudflare shows two nameservers for the site. At Namecheap: Domain List →
Manage → Nameservers → **Custom DNS** → paste both. Cloudflare emails you when
it becomes active, usually within an hour, at most 24.

**Before you switch:** Namecheap's email forwarding for `round24.app` (the
`eforward…registrar-servers.com` MX records) stops working the moment DNS
leaves Namecheap. Step 3 replaces it.

## 3. Inbound mail: Cloudflare Email Routing

Cloudflare → Email → Email Routing → enable. Add a destination (your Gmail),
verify it, then create the address `hello@round24.app` → your Gmail, plus a
catch-all if you want `dmarc@` and anything else to land somewhere. Cloudflare
writes its own MX and SPF records on `@`; don't add them by hand.

## 4. Outbound mail: Resend

Resend → Domains → Add `round24.app` (region US East). It shows three records;
add them in Cloudflare exactly as shown, DNS only:

- TXT `resend._domainkey` → the `p=…` key
- MX `send` → `feedback-smtp.us-east-1.amazonses.com`, priority 10
- TXT `send` → `v=spf1 include:amazonses.com ~all`

Then add DMARC in report-only mode: TXT `_dmarc` →
`v=DMARC1; p=none; rua=mailto:dmarc@round24.app`. Click Verify in Resend.
Once verified, `scripts/supabase-apply.sh` can point Supabase auth mail and the
welcome/invite sender at `hello@round24.app` (see docs/EMAIL-SETUP.md).

Resend signs from the `send` subdomain, so its SPF never collides with
Cloudflare Email Routing's SPF on the root.

## 5. Hardening (two clicks)

- DNS → Settings → **DNSSEC** → enable, then paste the DS record Cloudflare
  shows into Namecheap (Advanced DNS → DNSSEC).
- SSL/TLS → **Full (strict)**. Harmless while the Vercel records are DNS-only,
  and right if you ever proxy anything.

## 6. round24.com, when you have it

Add it as a second site, move its nameservers the same way, then Rules →
Redirect Rules → one rule: all requests → `https://round24.app` with the path
preserved, status 301. Proxy on for the `.com` records so the redirect runs at
Cloudflare's edge. The app's CORS lists already accept round24.com.

## Check it

```
dig +short NS round24.app          # two *.ns.cloudflare.com
dig +short A round24.app           # 216.150.1.1
dig +short MX round24.app          # route1/2/3.mx.cloudflare.net
dig +short TXT resend._domainkey.round24.app
```
