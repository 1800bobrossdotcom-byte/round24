// ============================================================
// Edge Function: push-send — delivers Web Push notifications.
//
// Called by the DATABASE, not by people: the notify_push() trigger (migration
// 0057) posts one trimmed row event per insert/update on work_orders,
// maintenance_requests, purchases and messages. This function decides who
// should hear about it, honors each person's Settings toggles, and pushes to
// every device they enabled from the bell. verify_jwt = false (there is no
// user session) — the shared x-push-secret header is the gate instead.
//
// Secrets: VAPID_KEYS_JSON      the pair printed by scripts/vapid-keys.mjs
//          VAPID_SUBJECT        mailto:you@yourdomain (push services may contact it)
//          PUSH_WEBHOOK_SECRET  same value as the push_config 'secret' row
//          APP_URL              optional, default https://round24.app
// Setup walkthrough: docs/PUSH-SETUP.md
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ApplicationServer, importVapidKeys, PushMessageError, Urgency } from 'jsr:@negrel/webpush@0.5.0';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
const SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@round24.app';
const APP_URL = (Deno.env.get('APP_URL') || 'https://round24.app').replace(/\/+$/, '');
const KEYS_JSON = Deno.env.get('VAPID_KEYS_JSON') || '';

type Row = Record<string, unknown>;
type Event = { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; record: Row; old_record: Row | null; actor?: string | null };
type Kind = 'wo' | 'chat' | 'purchase' | 'request';
type Priority = 'urgent' | 'high' | 'info';
type Notice = { to: Set<string>; kind: Kind; title: string; body: string; tag: string; tab: string; priority: Priority };
type People = { members: Set<string>; staff: Set<string>; assignee: (label: unknown) => string | undefined };
// deno-lint-ignore no-explicit-any
type Svc = any;

let appServer: ApplicationServer | null = null;
async function server(): Promise<ApplicationServer> {
  if (appServer) return appServer;
  if (!KEYS_JSON) throw new Error('VAPID_KEYS_JSON is not set');
  const vapidKeys = await importVapidKeys(JSON.parse(KEYS_JSON), { extractable: false });
  appServer = await ApplicationServer.new({ contactInformation: SUBJECT, vapidKeys });
  return appServer;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// constant-time compare — the secret is the only gate on this function
function secretOk(given: string | null): boolean {
  if (!SECRET || !given || given.length !== SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < SECRET.length; i++) diff |= SECRET.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---- text helpers ----
const s = (v: unknown, max = 120) =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const where = (r: Row) =>
  [s(r.property_label, 60), r.unit && r.unit !== '—' ? `Unit ${s(r.unit, 12)}` : ''].filter(Boolean).join(' · ');
const money = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
};
const PRIO: Record<number, Priority> = { 1: 'urgent', 2: 'high' };
const prioOf = (r: Row): Priority => PRIO[Number(r.priority)] || 'info';
const PRIO_WORD: Record<string, string> = { urgent: 'Urgent', high: 'High priority' };
// Web Push "Topic" header: ≤ 32 URL-safe chars; same topic → the push service
// keeps only the newest undelivered message for that device
const topicOf = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);

// ---- who's who in the org ----
// staff = office admins/managers (support seats excluded), members = everyone,
// assignee(label) = the user behind a work order's display-name assignee
async function orgPeople(svc: Svc, orgId: string): Promise<People> {
  const [{ data: mems }, { data: ops }] = await Promise.all([
    svc.from('memberships').select('user_id, role, is_support').eq('org_id', orgId),
    svc.from('operators').select('user_id, display_name').eq('org_id', orgId).not('user_id', 'is', null),
  ]);
  const members = new Set<string>();
  const staff = new Set<string>();
  const byName = new Map<string, string>();
  for (const m of (mems || []) as Row[]) {
    if (m.is_support) continue;
    members.add(String(m.user_id));
    if (m.role === 'admin' || m.role === 'manager') staff.add(String(m.user_id));
  }
  for (const o of (ops || []) as Row[]) {
    if (o.display_name && o.user_id) byName.set(String(o.display_name).trim().toLowerCase(), String(o.user_id));
  }
  const assignee = (label: unknown) => (label ? byName.get(String(label).trim().toLowerCase()) : undefined);
  return { members, staff, assignee };
}

// ---- routing: one event → who hears about it, and what it says ----
async function route(svc: Svc, ev: Event, people: People): Promise<Notice | null> {
  const r = ev.record;
  const o = ev.old_record || {};
  const to = new Set<string>();
  const add = (id: string | undefined) => { if (id) to.add(id); };
  const addAll = (ids: Set<string>) => ids.forEach((id) => to.add(id));
  const notice = (n: Omit<Notice, 'to'>): Notice => ({ to, ...n });

  if (ev.table === 'work_orders') {
    const task = s(r.task, 90);
    const at = where(r);
    const prio = prioOf(r);
    const asg = people.assignee(r.assignee_label);
    const tag = `wo:${r.id}`;
    if (ev.type === 'INSERT') {
      addAll(people.staff); add(asg);
      const report = r.status === 'pending' || r.source === 'field';
      return notice({ kind: 'wo', priority: prio, tag, tab: 'wo',
        title: `${report ? 'Field report' : 'New work order'}: ${task}`,
        body: [PRIO_WORD[prio], at].filter(Boolean).join(' · ') });
    }
    if (r.assignee_label !== o.assignee_label && asg) {
      add(asg);
      return notice({ kind: 'wo', priority: prio, tag, tab: 'wo', title: `Assigned to you: ${task}`,
        body: [PRIO_WORD[prio], at].filter(Boolean).join(' · ') });
    }
    if (Number(r.priority) !== Number(o.priority)) {
      addAll(people.staff); add(asg);
      const word = prio === 'urgent' ? 'Now urgent' : prio === 'high' ? 'Now high priority' : 'Priority lowered';
      return notice({ kind: 'wo', priority: prio, tag, tab: 'wo', title: `${word}: ${task}`, body: at });
    }
    if (r.status !== o.status) {
      const st = String(r.status);
      // crew progress goes to the office; office changes go to the assignee
      if (st === 'done' || st === 'in_progress') addAll(people.staff); else add(asg);
      const word: Record<string, string> = { done: 'Done', in_progress: 'Started', cancelled: 'Cancelled', open: 'Reopened', pending: 'Back to pending' };
      return notice({ kind: 'wo', priority: 'info', tag, tab: 'wo', title: `${word[st] || 'Updated'}: ${task}`, body: at });
    }
    return null;
  }

  if (ev.table === 'maintenance_requests' && ev.type === 'INSERT') {
    addAll(people.staff);
    return notice({ kind: 'request', priority: 'high', tag: `req:${r.id}`, tab: 'requests', title: 'New resident request',
      body: [where(r), s(r.tenant_name, 40), s(r.description, 90)].filter(Boolean).join(' · ') });
  }

  if (ev.table === 'purchases') {
    const label = [s(r.vendor, 40) || 'Purchase', money(r.amount)].filter(Boolean).join(' · ');
    const tag = `pur:${r.id}`;
    if (ev.type === 'INSERT') {
      addAll(people.staff);
      return notice({ kind: 'purchase', priority: 'info', tag, tab: 'pur', title: `Receipt · ${label}`,
        body: [s(r.submitted_by_label, 40), where(r)].filter(Boolean).join(' · ') || 'Waiting for review' });
    }
    if (r.status !== o.status && (r.status === 'approved' || r.status === 'rejected')) {
      add(r.created_by ? String(r.created_by) : undefined);
      return notice({ kind: 'purchase', priority: r.status === 'rejected' ? 'high' : 'info', tag, tab: 'pur',
        title: `Receipt ${r.status}: ${label}`, body: where(r) });
    }
    return null;
  }

  if (ev.table === 'messages' && ev.type === 'INSERT') {
    const channel = String(r.channel || 'all');
    if (channel === 'all' || channel.startsWith('wo:')) addAll(people.members);
    else {
      const { data: ch } = await svc.from('chat_channels').select('member_ids').eq('id', channel).maybeSingle();
      for (const id of (ch?.member_ids || []) as string[]) add(id);
    }
    const from = s(r.sender_label, 40) || 'Message';
    const text = s(r.body, 100) || (r.voice_path ? 'Voice note' : '');
    return notice({ kind: 'chat', priority: 'info', tag: `chat:${channel}`, tab: 'chat',
      title: channel.startsWith('wo:') ? `${from} · work order thread` : from, body: text });
  }
  return null;
}

// Settings → "Work-order alerts" / "Chat notifications" mute those kinds per person
async function applyPrefs(svc: Svc, ids: string[], kind: Kind): Promise<string[]> {
  if (kind !== 'wo' && kind !== 'chat') return ids;
  const { data } = await svc.from('user_settings').select('user_id, data').in('user_id', ids);
  const off = new Set<string>();
  for (const row of (data || []) as Row[]) {
    const notif = ((row.data as Row | null)?.notif || {}) as Row;
    if ((kind === 'wo' && notif.workOrders === false) || (kind === 'chat' && notif.chat === false)) off.add(String(row.user_id));
  }
  return ids.filter((id) => !off.has(id));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!secretOk(req.headers.get('x-push-secret'))) return json({ error: 'unauthorized' }, 401);

  let ev: Event;
  try { ev = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!ev || !ev.table || !ev.record || typeof ev.record !== 'object') return json({ error: 'bad event' }, 400);
  const orgId = ev.record.org_id ? String(ev.record.org_id) : '';
  if (!orgId) return json({ ok: true, skipped: 'no org' });

  try {
    const svc = createClient(SUPA_URL, SERVICE);
    const people = await orgPeople(svc, orgId);
    const notice = await route(svc, ev, people);
    if (!notice) return json({ ok: true, skipped: 'no notice' });

    // never ping the person who caused the event
    if (ev.actor) notice.to.delete(String(ev.actor));
    if (ev.type === 'INSERT' && ev.record.created_by) notice.to.delete(String(ev.record.created_by));
    if (ev.table === 'messages' && ev.record.sender_id) notice.to.delete(String(ev.record.sender_id));
    const targets = await applyPrefs(svc, [...notice.to], notice.kind);
    if (targets.length === 0) return json({ ok: true, sent: 0, targets: 0 });

    const { data: subs, error } = await svc.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', targets);
    if (error) throw error;
    if (!subs || subs.length === 0) return json({ ok: true, sent: 0, targets: targets.length });

    const app = await server();
    const payload = JSON.stringify({
      title: notice.title, body: notice.body, tag: notice.tag, tab: notice.tab, priority: notice.priority,
      url: `${APP_URL}/#${notice.tab}`,
    });
    const opts = { urgency: notice.priority === 'urgent' ? Urgency.High : Urgency.Normal, ttl: 86400, topic: topicOf(notice.tag) };

    const gone: string[] = [];
    let sent = 0, failed = 0;
    await Promise.all((subs as Row[]).map(async (sub) => {
      try {
        await app.subscribe({ endpoint: String(sub.endpoint), keys: { p256dh: String(sub.p256dh), auth: String(sub.auth) } })
          .pushTextMessage(payload, opts);
        sent++;
      } catch (e) {
        // 404/410 = the browser dropped this subscription; forget it
        if (e instanceof PushMessageError && (e.response.status === 404 || e.response.status === 410)) gone.push(String(sub.id));
        else failed++;
      }
    }));
    if (gone.length) await svc.from('push_subscriptions').delete().in('id', gone);
    return json({ ok: true, sent, failed, pruned: gone.length, targets: targets.length });
  } catch (e) {
    console.error('push-send', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
