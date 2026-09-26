#!/usr/bin/env python3
"""Apply Round24's DNS records to a Cloudflare zone, idempotently.

Needs in the environment (never on the command line):
  CLOUDFLARE_API_TOKEN   an API token with Zone → DNS → Edit on round24.app
Optional:
  CLOUDFLARE_ZONE        zone name (default round24.app)
  RESEND_DKIM            the p=… value Resend shows for resend._domainkey
  RESEND_SEND_MX         Resend's MX host for the send subdomain (default us-east-1)

Records are created or updated by (type, name); nothing is deleted. All are
DNS-only (unproxied): Vercel terminates TLS itself. Run: python3 scripts/cloudflare-dns.py
"""
import json, os, sys, urllib.request

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
ZONE = os.environ.get('CLOUDFLARE_ZONE', 'round24.app')
if not TOKEN: sys.exit('set CLOUDFLARE_API_TOKEN in the environment')
API = 'https://api.cloudflare.com/client/v4'

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    if not out.get('success'): sys.exit(f'{method} {path}: {out.get("errors")}')
    return out['result']

zones = call('GET', f'/zones?name={ZONE}')
if not zones: sys.exit(f'zone {ZONE} not found on this account — add the site in Cloudflare first')
zid = zones[0]['id']

records = [
    {'type': 'A', 'name': ZONE, 'content': '216.150.1.1', 'ttl': 300, 'proxied': False, 'comment': 'Vercel'},
    {'type': 'CNAME', 'name': f'www.{ZONE}', 'content': 'fad4174917219ebe.vercel-dns-016.com', 'ttl': 300, 'proxied': False, 'comment': 'Vercel'},
    {'type': 'TXT', 'name': f'_dmarc.{ZONE}', 'content': 'v=DMARC1; p=none; rua=mailto:dmarc@round24.app', 'ttl': 300, 'comment': 'DMARC, report-only'},
]
if os.environ.get('RESEND_DKIM'):
    mx = os.environ.get('RESEND_SEND_MX', 'feedback-smtp.us-east-1.amazonses.com')
    records += [
        {'type': 'TXT', 'name': f'resend._domainkey.{ZONE}', 'content': os.environ['RESEND_DKIM'], 'ttl': 300, 'comment': 'Resend DKIM'},
        {'type': 'MX', 'name': f'send.{ZONE}', 'content': mx, 'priority': 10, 'ttl': 300, 'comment': 'Resend'},
        {'type': 'TXT', 'name': f'send.{ZONE}', 'content': 'v=spf1 include:amazonses.com ~all', 'ttl': 300, 'comment': 'Resend SPF'},
    ]

existing = call('GET', f'/zones/{zid}/dns_records?per_page=200')
by_key = {(r['type'], r['name']): r for r in existing}
for rec in records:
    cur = by_key.get((rec['type'], rec['name']))
    if cur and cur['content'] == rec['content'] and cur.get('proxied', False) == rec.get('proxied', False):
        print(f"  = {rec['type']:5} {rec['name']:32} {rec['content']}"); continue
    if cur:
        call('PUT', f'/zones/{zid}/dns_records/{cur["id"]}', rec); print(f"  ~ {rec['type']:5} {rec['name']:32} {rec['content']}")
    else:
        call('POST', f'/zones/{zid}/dns_records', rec); print(f"  + {rec['type']:5} {rec['name']:32} {rec['content']}")
print('done')
