// ============================================================
// Edge Function: stock-check — for a list of items (e.g. from a scanned
// receipt), estimate for each whether it's typically in stock at a nearby
// big-box hardware store for same-day PICKUP, or a specialty item that must
// be ORDERED. AI estimate (Claude) — not live retailer inventory.
//
// Any authenticated org member may call it (office restocks, crew reorders).
// Secret: ANTHROPIC_API_KEY
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.70.0';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// CORS: reflect only the app's own origins (audit S5) — never '*'. Re-bound per
// request in the handler; a concurrent re-bind can only swap one allowlisted
// origin for another, so it stays safe.
const CORS_ORIGINS = ['https://round24.app', 'https://www.round24.app', 'http://localhost:5173', 'http://localhost:4173'];
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0],
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});
let CORS = corsFor(null);

const STOCK_TOOL = {
  name: 'record_availability',
  description: 'Record likely local availability for each maintenance/supply item.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'The item (echo the input description, tidied).' },
            availability: { type: 'string', enum: ['pickup', 'order'], description: 'pickup = commonly stocked locally for same-day; order = specialty / must be ordered.' },
            source: { type: 'string', description: 'Likely source, e.g. "Home Depot / Lowe\'s", "Ferguson", "electrical supply house".' },
            eta: { type: 'string', description: 'Rough availability, e.g. "Today", "1-2 days", "3-5 days".' },
            note: { type: 'string', description: 'One short sourcing tip. Empty if none.' },
          },
          required: ['name', 'availability', 'source', 'eta'],
        },
      },
    },
    required: ['items'],
  },
};

Deno.serve(async (req) => {
  CORS = corsFor(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: 'unauthorized' }, 401);
    const { data: mem } = await supabase.from('memberships').select('org_id').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);
    const { data: q } = await supabase.rpc('ai_quota_bump', { p_limit: 200 });
    const quota = Array.isArray(q) ? q[0] : q;
    if (quota && quota.allowed === false) return json({ error: 'Daily AI limit reached. Try again tomorrow.' }, 429);

    if (!ANTHROPIC_API_KEY) return json({ error: 'Stock check not configured. Set the ANTHROPIC_API_KEY secret.' }, 400);

    const body = await req.json().catch(() => ({}));
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100); // cap list length
    if (!items.length) return json({ error: 'no items' }, 400);
    const location = body.location ? ` The property is in ${body.location}.` : '';

    const list = items.map((it: any, i: number) => `${i + 1}. ${it.description || it.name}${it.qty ? ` (qty ${it.qty})` : ''}`).join('\n');

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      system: [
        'You are a procurement assistant for a US property-maintenance company.',
        'For each item, estimate whether it is the kind of thing typically in stock at a nearby big-box hardware store (Home Depot, Lowe\'s, Ace) for same-day PICKUP, or a specialty item that usually must be ORDERED from a supply house or online.',
        'Common consumables, standard fittings, paint, basic tools, fasteners → pickup. Specialty parts, specific appliance components, made-to-order, or uncommon sizes → order.',
        'Give a likely source and a rough ETA. This is a general estimate, not live inventory.',
        'Always call record_availability with one entry per input item, in order.',
      ].join(' '),
      tools: [STOCK_TOOL],
      tool_choice: { type: 'tool', name: 'record_availability' },
      messages: [{ role: 'user', content: `Items to source:${location}\n${list}\n\nRecord availability for each.` }],
    });

    const block = resp.content.find((b: any) => b.type === 'tool_use');
    if (!block) return json({ error: 'model returned no structured result' }, 502);
    const r = block.input as any;
    return json({ ok: true, items: Array.isArray(r.items) ? r.items : [] });
  } catch (_e) {
    return json({ error: 'internal error' }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
