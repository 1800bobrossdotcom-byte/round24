// ============================================================
// Edge Function: receipt-ocr — reads a receipt photo with Claude vision and
// returns structured line items + AI price-match flags.
//
// Runs on Supabase's SERVER (Deno). The ANTHROPIC_API_KEY lives in Supabase
// secrets, never in the browser. ANY authenticated org member may call this —
// crew submit their own receipts from the field; it is NOT staff-gated like
// getdek (there's no financial-decryption boundary here, just OCR).
//
// Flow:
//   1. verify the caller is an authenticated org member
//   2. accept { image: <base64>, mimeType?: <"image/jpeg"...> }
//   3. call Claude opus-4-8 with the image + a forced strict tool
//      `record_receipt` so the model MUST return a validated object
//   4. return { vendor, total, date, category, lineItems[], priceFlags[] }
//
// priceFlags = AI price-matching: Claude flags any line item whose unit price
// looks high for that item/category so the office can review before approving.
//
// Secret (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.70.0';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// strict schema Claude is FORCED to fill — no free-form text, no parsing.
const RECEIPT_TOOL = {
  name: 'record_receipt',
  description: 'Record the structured contents of a maintenance/supply receipt.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      vendor: { type: 'string', description: 'Store / vendor name, e.g. "Home Depot". Empty string if unreadable.' },
      total: { type: 'number', description: 'Grand total actually charged, in dollars. 0 if unreadable.' },
      date: { type: 'string', description: 'Purchase date as YYYY-MM-DD. Empty string if not on the receipt.' },
      cardLast4: { type: 'string', description: 'Last 4 digits of the card from the payment/tender line (e.g. "4471"). Empty string if not shown.' },
      cardBrand: { type: 'string', description: 'Card brand if shown (Visa, Mastercard, Amex, Discover). Empty string if not shown.' },
      category: {
        type: 'string',
        description: 'Best single spend category for the whole receipt.',
        enum: ['plumbing', 'electrical', 'hardware', 'paint', 'appliance', 'hvac', 'landscaping', 'cleaning', 'fuel', 'tools', 'general'],
      },
      lineItems: {
        type: 'array',
        description: 'Every purchasable line on the receipt (skip subtotals/tax/total lines).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            qty: { type: 'number' },
            unitPrice: { type: 'number', description: 'Price per unit in dollars.' },
            amount: { type: 'number', description: 'Line total in dollars (qty × unitPrice).' },
          },
          required: ['description', 'qty', 'unitPrice', 'amount'],
        },
      },
      priceFlags: {
        type: 'array',
        description: 'Line items whose unit price looks high for that item or category — for office review. Empty array if nothing stands out.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            item: { type: 'string', description: 'The line-item description being flagged.' },
            paid: { type: 'number', description: 'Unit price paid, in dollars.' },
            typical: { type: 'number', description: 'Your estimate of a typical unit price for this item, in dollars.' },
            note: { type: 'string', description: 'One short sentence on why this is flagged.' },
          },
          required: ['item', 'paid', 'note'],
        },
      },
    },
    required: ['vendor', 'total', 'date', 'cardLast4', 'category', 'lineItems', 'priceFlags'],
  },
};

const SYSTEM = [
  'You are a receipts clerk for a property-maintenance company.',
  'You read a photo or PDF of a purchase receipt and return its contents via the record_receipt tool.',
  'Transcribe exactly what is printed — never invent items or prices.',
  'Read the payment/tender line and capture the last 4 digits of the card into cardLast4 (e.g. "VISA ************4471" or "XXXXXXXXXXXX4471" → "4471"), and the brand into cardBrand. Leave them empty only if no card digits are shown.',
  'For price-matching: using your general knowledge of US hardware/supply retail prices, flag any line item whose unit price is clearly high for that item (roughly 25%+ over typical). Do not flag ordinary prices.',
  'Always call the record_receipt tool. If the image is not a readable receipt, return empty/zero fields.',
].join(' ');

Deno.serve(async (req) => {
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

    // any member of an org may scan a receipt
    const { data: mem } = await supabase.from('memberships').select('org_id').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);

    if (!ANTHROPIC_API_KEY) {
      return json({ error: 'Receipt scanning not configured. Set the ANTHROPIC_API_KEY secret to enable AI OCR.' }, 400);
    }

    const body = await req.json().catch(() => ({}));
    let image: string = body.image || '';
    const mimeType: string = body.mimeType || 'image/jpeg';
    if (!image) return json({ error: 'no image' }, 400);
    // accept a full data: URL or a bare base64 payload
    const comma = image.indexOf(',');
    if (image.startsWith('data:') && comma >= 0) image = image.slice(comma + 1);

    // PDFs go in as a document block (Claude reads them natively); images as an
    // image block. This lets crew upload a PDF receipt, not just a photo.
    const isPdf = mimeType === 'application/pdf';
    const media = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } };

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: SYSTEM,
      tools: [RECEIPT_TOOL],
      tool_choice: { type: 'tool', name: 'record_receipt' },
      messages: [{
        role: 'user',
        content: [
          media,
          { type: 'text', text: 'Read this receipt and record it with the record_receipt tool.' },
        ],
      }],
    });

    const block = resp.content.find((b: any) => b.type === 'tool_use');
    if (!block) return json({ error: 'model returned no structured result' }, 502);

    const r = block.input as ReceiptResult;
    // light normalization / defensive defaults
    const result = {
      vendor: r.vendor || '',
      total: num(r.total),
      date: r.date || '',
      cardLast4: (r.cardLast4 || '').replace(/\D/g, '').slice(-4),
      cardBrand: r.cardBrand || '',
      category: r.category || 'general',
      lineItems: Array.isArray(r.lineItems) ? r.lineItems.map((li) => ({
        description: li.description || '', qty: num(li.qty, 1),
        unitPrice: num(li.unitPrice), amount: num(li.amount),
      })) : [],
      priceFlags: Array.isArray(r.priceFlags) ? r.priceFlags.map((f) => ({
        item: f.item || '', paid: num(f.paid), typical: num((f as any).typical), note: f.note || '',
      })) : [],
    };
    return json({ ok: true, receipt: result });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

interface ReceiptResult {
  vendor: string; total: number; date: string; cardLast4?: string; cardBrand?: string; category: string;
  lineItems: Array<{ description: string; qty: number; unitPrice: number; amount: number }>;
  priceFlags: Array<{ item: string; paid: number; typical?: number; note: string }>;
}

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
