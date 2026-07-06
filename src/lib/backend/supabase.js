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

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session));
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
