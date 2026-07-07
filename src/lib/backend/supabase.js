// ============================================================
// Supabase client — real auth + Postgres with RLS.
// config comes from Vite env vars (set in Vercel, never committed):
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// the anon key is safe for the browser — RLS is what protects data,
// not key secrecy. row-level security policies (see migration) ensure
// a user only ever sees their own org's rows.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;
export const isConfigured = () => !!supabase;

// ---- auth helpers ----
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session));
}

// the caller's org + role — drives which tools they can see.
// RLS enforces the same boundary server-side; this is for the UI.
export async function fetchMembership() {
  const { data, error } = await supabase
    .from('memberships').select('org_id, role').limit(1).maybeSingle();
  if (error) throw error;
  return data; // { org_id, role } or null
}

// ---- work orders ----
const woFromDb = (r) => ({
  id: r.id, propLabel: r.property_label, unit: r.unit, task: r.task,
  detail: r.detail, category: r.category, assigneeLabel: r.assignee_label,
  due: r.due_date, status: r.status, source: r.source, priority: r.priority ?? 3,
  transcript: r.voice_transcript, createdAt: r.created_at,
});

export async function listWorkOrders(orgId) {
  const { data, error } = await supabase
    .from('work_orders').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(woFromDb);
}

export async function insertWorkOrder(orgId, wo) {
  const { data, error } = await supabase.from('work_orders').insert({
    org_id: orgId, property_label: wo.propLabel || null, unit: wo.unit || null,
    task: wo.task, detail: wo.detail || null, category: wo.category || 'general',
    assignee_label: wo.assigneeLabel || null, due_date: wo.due || null,
    status: wo.status || 'open', source: wo.source || 'manual',
    priority: wo.priority ?? 3,
    voice_transcript: wo.transcript || null,
  }).select().single();
  if (error) throw error;
  return woFromDb(data);
}

export async function updateWorkOrderStatus(id, status) {
  const { error } = await supabase.from('work_orders').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function updateWorkOrderPriority(id, priority) {
  const { error } = await supabase.from('work_orders').update({ priority }).eq('id', id);
  if (error) throw error;
}

export async function updateWorkOrderAssignee(id, assigneeLabel) {
  const { error } = await supabase.from('work_orders').update({ assignee_label: assigneeLabel }).eq('id', id);
  if (error) throw error;
}

// live task-list updates — RLS scopes events to rows the caller can see
export function subscribeWorkOrders(orgId, cb) {
  const ch = supabase.channel('wo-live-' + orgId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'work_orders', filter: `org_id=eq.${orgId}` },
      (payload) => cb(payload))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---- team comms: messages + voice notes ----
const msgFromDb = (r) => ({
  id: r.id, channel: r.channel, workOrderId: r.work_order_id,
  body: r.body, voicePath: r.voice_path, voiceSecs: r.voice_secs,
  senderId: r.sender_id, sender: r.sender_label, senderRole: r.sender_role,
  createdAt: r.created_at,
});

export async function listMessages(orgId) {
  const { data, error } = await supabase
    .from('messages').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  return data.map(msgFromDb);
}

export async function insertMessage(orgId, m) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('messages').insert({
    org_id: orgId, channel: m.channel || 'all', work_order_id: m.workOrderId || null,
    body: m.body || null, voice_path: m.voicePath || null, voice_secs: m.voiceSecs || null,
    sender_id: user?.id, sender_label: m.sender || null, sender_role: m.senderRole || null,
  }).select().single();
  if (error) throw error;
  return msgFromDb(data);
}

export function subscribeMessages(orgId, cb) {
  const ch = supabase.channel('msg-live-' + orgId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` },
      (payload) => cb(msgFromDb(payload.new)))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---- chat directory + private channels (DMs / groups) ----
export async function upsertChatMember(orgId, { label, role }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('chat_members')
    .upsert({ org_id: orgId, user_id: user.id, label, role, updated_at: new Date().toISOString() }, { onConflict: 'org_id,user_id' });
  if (error) throw error;
}

export async function listChatMembers(orgId) {
  const { data, error } = await supabase.from('chat_members').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data.map((r) => ({ id: r.user_id, label: r.label, role: r.role }));
}

const chFromDb = (r) => ({ id: 'ch:' + r.id, dbId: r.id, kind: r.kind, name: r.name, memberIds: r.member_ids || [], memberLabels: r.member_labels || [] });

export async function listChatChannels(orgId) {
  const { data, error } = await supabase.from('chat_channels').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data.map(chFromDb);
}

export async function insertChatChannel(orgId, { kind, name, memberIds, memberLabels }) {
  const { data, error } = await supabase.from('chat_channels').insert({
    org_id: orgId, kind, name: name || null, member_ids: memberIds, member_labels: memberLabels,
  }).select().single();
  if (error) throw error;
  return chFromDb(data);
}

// upload a recorded voice note (Blob) → returns the storage object path
export async function uploadVoiceNote(orgId, blob) {
  const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
  const path = `${orgId}/${Date.now()}_note.${ext}`;
  const { error } = await supabase.storage.from('voicenotes').upload(path, blob, { contentType: blob.type });
  if (error) throw error;
  return path;
}

// AI: summarize a chat thread into a work-order update (server-side, Claude)
export async function summarizeThread(messages, workOrder) {
  const { data, error } = await supabase.functions.invoke('chat-summary', { body: { messages, workOrder } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context.json()).error || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return data.summary;
}

// ---- cloud timers: crew hours land where management can see them ----
// RLS: a tech can only insert timers for their own operator record.
export async function fetchMyOperatorId() {
  const { data, error } = await supabase
    .from('operators').select('id, user_id').limit(10);
  if (error) throw error;
  const { data: { user } } = await supabase.auth.getUser();
  return data.find((o) => o.user_id === user?.id)?.id || null;
}

export async function insertTimer(orgId, operatorId, t) {
  const { data, error } = await supabase.from('timers').insert({
    org_id: orgId, operator_id: operatorId,
    property_label: t.propLabel || null, unit: t.unit || null,
    work_date: t.date, category: t.category || 'general',
    issue: t.issue || null, duration_hrs: t.durationHrs,
    note: t.note || null, work_order_id: t.workOrderId || null,
    source: 'timer',
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

// ---- purchases (material receipts) ----
const purFromDb = (r) => ({
  id: r.id, workOrderId: r.work_order_id, propLabel: r.property_label,
  vendor: r.vendor, amount: Number(r.amount), note: r.note,
  receiptPath: r.receipt_path, status: r.status, lineItems: r.line_items || null,
  submittedBy: r.submitted_by_label, createdAt: r.created_at,
});

export async function listPurchases(orgId) {
  const { data, error } = await supabase
    .from('purchases').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(purFromDb);
}

export async function insertPurchase(orgId, p) {
  const { data, error } = await supabase.from('purchases').insert({
    org_id: orgId, work_order_id: p.workOrderId || null,
    property_label: p.propLabel || null, vendor: p.vendor || null,
    amount: p.amount, note: p.note || null, receipt_path: p.receiptPath || null,
    line_items: p.lineItems || null, submitted_by_label: p.submittedBy || null,
  }).select().single();
  if (error) throw error;
  return purFromDb(data);
}

export async function setPurchaseStatus(id, status) {
  const { error } = await supabase.from('purchases').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function uploadReceipt(orgId, file) {
  const path = `${orgId}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file);
  if (error) throw error;
  return path;
}

// ---- documents ----
const docFromDb = (r) => ({
  id: r.id, name: r.name, path: r.path, category: r.category,
  visibility: r.visibility, createdAt: r.created_at,
});

export async function listDocuments(orgId) {
  const { data, error } = await supabase
    .from('documents').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(docFromDb);
}

export async function uploadDocument(orgId, file, { category = 'general', visibility = 'org' } = {}) {
  const path = `${orgId}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`;
  const { error: upErr } = await supabase.storage.from('docs').upload(path, file);
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('documents').insert({
    org_id: orgId, name: file.name, path, category, visibility,
  }).select().single();
  if (error) throw error;
  return docFromDb(data);
}

export async function signedFileUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// native buildings discovered from an Excel import (non-integrated shops)
export async function insertProperties(orgId, props) {
  const rows = props.map((p) => ({
    org_id: orgId, name: p.name, city: p.city || null, units: p.units || 0, external_src: 'native',
  }));
  const { error } = await supabase.from('properties').insert(rows);
  if (error) throw error;
}

// ---- Rent Manager sync ----
export async function triggerRmSync({ mock = false } = {}) {
  const { data, error } = await supabase.functions.invoke('rm-sync', { body: { mock } });
  if (error) {
    // surface the function's own error body (e.g. "not configured")
    let detail = error.message;
    try { detail = (await error.context.json()).error || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return data;
}

// ---- AI receipt OCR + price-match (Claude vision, server-side) ----
// image: a base64 string or data: URL. Returns
// { vendor, total, date, category, lineItems[], priceFlags[] }.
export async function scanReceipt(image, mimeType = 'image/jpeg') {
  const { data, error } = await supabase.functions.invoke('receipt-ocr', { body: { image, mimeType } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context.json()).error || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return data.receipt;
}

// ---- per-property credit cards (auto-file receipts by card) ----
const cardFromDb = (r) => ({ id: r.id, last4: r.last4, brand: r.brand, propLabel: r.property_label, label: r.label });

export async function listPropertyCards(orgId) {
  const { data, error } = await supabase.from('property_cards').select('*').eq('org_id', orgId).order('created_at');
  if (error) throw error;
  return data.map(cardFromDb);
}

export async function insertPropertyCard(orgId, c) {
  const { data, error } = await supabase.from('property_cards').insert({
    org_id: orgId, last4: c.last4, brand: c.brand || null, property_label: c.propLabel, label: c.label || null,
  }).select().single();
  if (error) throw error;
  return cardFromDb(data);
}

export async function deletePropertyCard(id) {
  const { error } = await supabase.from('property_cards').delete().eq('id', id);
  if (error) throw error;
}

// ---- AI local-stock check: pickup vs order per item (Claude, server-side) ----
export async function checkStock(items, location) {
  const { data, error } = await supabase.functions.invoke('stock-check', { body: { items, location } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context.json()).error || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return data.items;
}

export async function getRmConnection(orgId) {
  const { data, error } = await supabase
    .from('rm_connections').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function countExternal(table, orgId, src = 'rm') {
  const { count, error } = await supabase
    .from(table).select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('external_src', src);
  if (error) throw error;
  return count || 0;
}

// ---- fetch the session DEK from the server (Edge Function unwraps via KMS) ----
// returns a 32-byte Uint8Array. NEVER hardcode or cache to disk.
export async function fetchDEK() {
  const { data, error } = await supabase.functions.invoke('getdek');
  if (error) throw new Error('Could not obtain encryption key: ' + error.message);
  // function returns base64 of the 32-byte DEK
  const bin = atob(data.dek);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
