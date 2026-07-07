// ============================================================
// Edge Function: rm-sync — Rent Manager read-only property/unit pull.
// Server-side only: RM credentials live in Supabase secrets, never the
// browser (same trust model as getdek). Staff-only.
//
// Two paths:
//   • { "mock": true }  → runs the FULL pipeline (map → upsert → summary)
//     on realistic sample data. Fully testable today; also the partnership
//     /funding demo path — shows the integration working before RM grants
//     access.
//   • live              → authenticates to RM, discovers the location,
//     pulls Properties + Units, upserts with external_src='rm'.
//
// Conflict rule (locked): RM wins on properties/units. We upsert RM rows;
// we never push property/unit edits back to RM.
//
// Secrets (set when RM access lands — see docs/RM-API-NOTES.md):
//   CALIPER_RM_USERNAME, CALIPER_RM_PASSWORD,
//   CALIPER_RM_BASE_URL (default https://evolution.api.rentmanager.com),
//   CALIPER_RM_LOCATION_ID (optional; auto-discovered if unset)
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RM_BASE = Deno.env.get('CALIPER_RM_BASE_URL') || 'https://evolution.api.rentmanager.com';
const RM_USER = Deno.env.get('CALIPER_RM_USERNAME');
const RM_PASS = Deno.env.get('CALIPER_RM_PASSWORD');
const RM_LOCATION = Deno.env.get('CALIPER_RM_LOCATION_ID');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);

    const { data: mem } = await supabase.from('memberships').select('org_id, role').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);
    if (!['admin', 'manager'].includes(mem.role)) return json({ error: 'forbidden: staff only' }, 403);
    const orgId = mem.org_id;

    const body = await req.json().catch(() => ({}));
    const mock = body.mock === true;

    let props: MappedProp[], units: MappedUnit[], location: string;
    if (mock) {
      ({ props, units } = mockData());
      location = 'SAMPLE';
    } else {
      if (!RM_USER || !RM_PASS) {
        return json({ error: 'Rent Manager not configured. Set CALIPER_RM_* secrets, or call with {"mock":true} to preview the pipeline.' }, 400);
      }
      ({ props, units, location } = await pullFromRM());
    }

    // upsert via service role (trusted server process; scoped to caller's org)
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const propIdByExt: Record<string, string> = {};
    let pCount = 0, uCount = 0;
    const errors: string[] = [];

    for (const p of props) {
      const { data, error } = await admin.from('properties').upsert({
        org_id: orgId, name: p.name, city: p.city, units: p.unitCount ?? 0,
        external_src: 'rm', external_id: String(p.externalId),
      }, { onConflict: 'org_id,external_src,external_id' }).select('id').single();
      if (error) errors.push(`property ${p.externalId}: ${error.message}`);
      else { propIdByExt[String(p.externalId)] = data.id; pCount++; }
    }
    for (const u of units) {
      const { error } = await admin.from('units').upsert({
        org_id: orgId, property_id: propIdByExt[String(u.propExternalId)] || null,
        name: u.name, beds: u.beds, baths: u.baths, status: u.status,
        external_src: 'rm', external_id: String(u.externalId),
      }, { onConflict: 'org_id,external_src,external_id' });
      if (error) errors.push(`unit ${u.externalId}: ${error.message}`);
      else uCount++;
    }

    const summary = { properties: pCount, units: uCount, location, mock, errors: errors.slice(0, 10), at: new Date().toISOString() };
    await admin.from('rm_connections').upsert({
      org_id: orgId, base_url: RM_BASE, status: mock ? 'preview' : 'active',
      rm_location_id: location, last_sync_at: summary.at, last_sync_summary: summary,
    }, { onConflict: 'org_id' });

    return json({ ok: true, ...summary });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

// ---- live RM pull -------------------------------------------------------
// NOTE: RM's full resource field names live in the API Test Client
// (evolution.api.rentmanager.com, needs the API-enabled account). The
// mappers below use RM's conventional PascalCase fields with fallbacks;
// validate + tighten against real responses when access lands.
async function pullFromRM(): Promise<{ props: MappedProp[]; units: MappedUnit[]; location: string }> {
  const token = await rmAuth();
  let location = RM_LOCATION || '';
  if (!location) {
    // first call omits the location header so RM routes to first available
    const r = await fetch(`${RM_BASE}/Current/Locations`, { headers: rmHeaders(token) });
    if (!r.ok) throw new Error(`RM /Current/Locations ${r.status}: ${await r.text()}`);
    const locs = await r.json();
    location = String(locs?.[0]?.LocationID ?? '');
  }
  const h = rmHeaders(token, location);
  const props = (await rmGet(`${RM_BASE}/Properties`, h)).map(mapProperty).filter((p) => p.externalId != null);
  const units = (await rmGet(`${RM_BASE}/Units`, h)).map(mapUnit).filter((u) => u.externalId != null);
  return { props, units, location };
}

async function rmAuth(): Promise<string> {
  const r = await fetch(`${RM_BASE}/Authentication/AuthorizeUser`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UserName: RM_USER, Password: RM_PASS }),
  });
  if (!r.ok) throw new Error(`RM auth ${r.status}: ${await r.text()}`);
  // RM returns the token as a bare (JSON-quoted) string
  return (await r.text()).replace(/^"|"$/g, '').trim();
}

async function rmGet(url: string, headers: Record<string, string>): Promise<any[]> {
  const r = await fetch(url, { headers });
  if (r.status === 204) return [];            // permission-scoped empty, not an error
  if (!r.ok) throw new Error(`RM GET ${url} ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data) ? data : (data?.value ?? []);
}

function rmHeaders(token: string, location?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-rm12api-apitoken': token };
  if (location) h['x-rm12api-locationid'] = location;
  return h;
}

interface MappedProp { externalId: unknown; name: string; city: string | null; unitCount?: number; }
interface MappedUnit { externalId: unknown; propExternalId: unknown; name: string; beds: number | null; baths: number | null; status: string | null; }

function mapProperty(r: any): MappedProp {
  return {
    externalId: r.PropertyID ?? r.Id ?? r.propertyID,
    name: r.Name ?? r.ShortName ?? `Property ${r.PropertyID ?? ''}`.trim(),
    city: r.Addresses?.[0]?.City ?? r.PrimaryAddress?.City ?? r.City ?? null,
    unitCount: r.UnitCount ?? undefined,
  };
}
function mapUnit(r: any): MappedUnit {
  return {
    externalId: r.UnitID ?? r.Id,
    propExternalId: r.PropertyID ?? r.Property?.PropertyID,
    name: r.Name ?? r.UnitName ?? `Unit ${r.UnitID ?? ''}`.trim(),
    beds: numOrNull(r.Bedrooms ?? r.Beds),
    baths: numOrNull(r.Bathrooms ?? r.Baths),
    status: r.UnitStatus ?? r.Status ?? null,
  };
}
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

// ---- sample data: mirrors the Evolution24 portfolio shape ---------------
function mockData(): { props: MappedProp[]; units: MappedUnit[] } {
  const props: MappedProp[] = [
    { externalId: 'RM-P1', name: '301 Central Ave', city: 'Rochester', unitCount: 14 },
    { externalId: 'RM-P2', name: '179-189 St Paul', city: 'Rochester', unitCount: 22 },
    { externalId: 'RM-P3', name: '379 Main St', city: 'Geneva', unitCount: 9 },
    { externalId: 'RM-P4', name: '561 S Main St', city: 'Geneva', unitCount: 12 },
  ];
  const units: MappedUnit[] = [];
  const layout: Record<string, string[]> = {
    'RM-P1': ['1A', '1B', '2A', '2B', '3C'],
    'RM-P2': ['3C', '4B', '5A', '5B'],
    'RM-P3': ['1', '2', '3'],
    'RM-P4': ['A', 'B', 'C', 'D'],
  };
  const statuses = ['occupied', 'occupied', 'vacant', 'notice'];
  let i = 0;
  for (const [pid, list] of Object.entries(layout)) {
    for (const name of list) {
      units.push({
        externalId: `RM-U${++i}`, propExternalId: pid, name,
        beds: (i % 3) + 1, baths: 1, status: statuses[i % statuses.length],
      });
    }
  }
  return { props, units };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
