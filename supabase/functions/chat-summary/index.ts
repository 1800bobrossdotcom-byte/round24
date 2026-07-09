// ============================================================
// Edge Function: chat-summary — turns a work-order chat thread into a
// structured work-order update using Claude.
//
// Any authenticated org member may call it. Reads a thread of messages
// (+ optional work order context) and returns { status, summary, nextSteps }
// via a forced strict tool so the result is always structured.
//
// Secret: ANTHROPIC_API_KEY  (same key as receipt-ocr)
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.70.0';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUMMARY_TOOL = {
  name: 'record_update',
  description: 'Record a concise work-order update distilled from the crew/office chat.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        description: 'Best read of the job status from the conversation.',
        enum: ['open', 'in_progress', 'blocked', 'done', 'unclear'],
      },
      summary: { type: 'string', description: '2-3 sentence plain-language summary of what happened / where the job stands.' },
      nextSteps: { type: 'array', description: 'Concrete next actions mentioned or implied. Empty if none.', items: { type: 'string' } },
    },
    required: ['status', 'summary', 'nextSteps'],
  },
};

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
    const { data: mem } = await supabase.from('memberships').select('org_id').limit(1).single();
    if (!mem) return json({ error: 'no org' }, 403);
    const { data: q } = await supabase.rpc('ai_quota_bump', { p_limit: 200 });
    const quota = Array.isArray(q) ? q[0] : q;
    if (quota && quota.allowed === false) return json({ error: 'Daily AI limit reached. Try again tomorrow.' }, 429);

    if (!ANTHROPIC_API_KEY) {
      return json({ error: 'AI summaries not configured. Set the ANTHROPIC_API_KEY secret to enable them.' }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0, 300); // cap thread length
    if (!messages.length) return json({ error: 'no messages' }, 400);
    const wo = body.workOrder || null;

    const transcript = messages
      .map((m: any) => `${m.sender || 'someone'} (${m.role || 'crew'}): ${m.body || '[voice note]'}`)
      .join('\n');
    const woCtx = wo ? `Work order: "${wo.task}"${wo.propLabel ? ` at ${wo.propLabel}` : ''}${wo.unit ? ` unit ${wo.unit}` : ''} (current status: ${wo.status || 'open'}).\n\n` : '';

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: 'You are a dispatcher for a property-maintenance company. Read the crew/office chat about a job and record a tight, factual work-order update. Do not invent details not in the chat.',
      tools: [SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: 'record_update' },
      messages: [{ role: 'user', content: `${woCtx}Chat thread:\n${transcript}\n\nRecord the work-order update.` }],
    });

    const block = resp.content.find((b: any) => b.type === 'tool_use');
    if (!block) return json({ error: 'model returned no structured result' }, 502);
    const r = block.input as any;
    return json({ ok: true, summary: { status: r.status || 'unclear', summary: r.summary || '', nextSteps: Array.isArray(r.nextSteps) ? r.nextSteps : [] } });
  } catch (_e) {
    return json({ error: 'internal error' }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
