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
  due: r.due_date, status: r.status, source: r.source,
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
    voice_transcript: wo.transcript || null,
  }).select().single();
  if (error) throw error;
  return woFromDb(data);
}

export async function updateWorkOrderStatus(id, status) {
  const { error } = await supabase.from('work_orders').update({ status }).eq('id', id);
  if (error) throw error;
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
