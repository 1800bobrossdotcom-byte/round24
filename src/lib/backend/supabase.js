// ============================================================
// Supabase client — real auth + Postgres with RLS.
// config comes from Vite env vars (set in Vercel, never committed):
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// the anon key is safe for the browser — RLS is what protects data,
// not key secrecy. row-level security policies (see migration) ensure
// a user only ever sees their own org's rows.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { importKey, encryptField, decryptField } from './crypto.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;
export const isConfigured = () => !!supabase;

// ---- field encryption (AES-256-GCM, DEK unwrapped from AWS KMS per session) ----
// The DEK is fetched once and kept in memory only. Sensitive PII in user_settings
// (tax / emergency contact) is encrypted at rest with it. Fail-SAFE: if the key
// can't be obtained, we store/return plaintext rather than lose or block data.
const ENC_SETTINGS_FIELDS = ['tax', 'emergency'];
let _dekKeyPromise = null;
function orgKey() {
  if (!_dekKeyPromise) _dekKeyPromise = fetchDEK().then(importKey).catch((e) => { _dekKeyPromise = null; throw e; });
  return _dekKeyPromise;
}

// ---- reusable dual-mode field encryption ----------------------------------
// Any at-rest field can carry ciphertext ('enc1:'+base64) OR legacy plaintext.
// encStr/decStr make wiring a NEW sensitive field a one-liner and keep old rows
// readable until they're re-saved. Fail-SAFE: no key → store/return as-is.
const ENC_PREFIX = 'enc1:';
export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(ENC_PREFIX);
// fail-CLOSED: if the org key can't be fetched (KMS/getdek outage) we must NOT
// write sensitive data as plaintext. Throw so the caller's optimistic-write
// catch keeps the edit local and skips the DB write until encryption recovers.
const SECURE_UNAVAILABLE = 'secure-storage-unavailable';
async function encStr(v) {
  if (v == null || v === '') return v;
  if (isEncrypted(v)) return v; // already encrypted
  try { return ENC_PREFIX + await encryptField(await orgKey(), String(v)); }
  catch { throw new Error(SECURE_UNAVAILABLE); }
}
const DEC_MASK = '•••'; // shown when a field can't be decrypted (KMS down) — must never be saved back over ciphertext
async function decStr(v) {
  if (!isEncrypted(v)) return v; // legacy plaintext (or empty) — pass through
  try { return await decryptField(await orgKey(), v.slice(ENC_PREFIX.length)); }
  catch { return DEC_MASK; } // key unavailable (e.g. KMS down) → mask, never show ciphertext
}
// encrypt/decrypt several fields of a row object at once
async function encFields(row, fields) {
  const out = { ...row };
  for (const f of fields) if (f in out) out[f] = await encStr(out[f]);
  return out;
}
async function decFields(row, fields) {
  const out = { ...row };
  for (const f of fields) if (f in out) out[f] = await decStr(out[f]);
  return out;
}
// sensitive at-rest fields, by table — add a field here to encrypt it going forward
const ENC_LEASE_FIELDS = ['tenant_name', 'tenant_phone'];

// whole-JSON encryption for a blob column (e.g. the labor spine, which carries
// pay rates on every row). Dual-mode + fail-safe: no key → store the raw value.
async function encBlob(v) {
  if (v == null) return v;
  // fail-CLOSED (see encStr): never persist the labor spine's pay data plaintext.
  try { return ENC_PREFIX + await encryptField(await orgKey(), JSON.stringify(v)); }
  catch { throw new Error(SECURE_UNAVAILABLE); }
}
async function decBlob(v) {
  if (!isEncrypted(v)) return v; // legacy array/object passes through
  // fail-CLOSED: a value that IS encrypted but can't be decrypted (KMS/getdek
  // outage) must NOT be returned as ciphertext — getLaborState's caller would
  // coerce the unshaped string to empty and the 900ms write-through would then
  // overwrite the org's real labor spine with nothing. Let this throw so
  // getLaborState throws and hydration's .catch keeps laborBackend='local'
  // (no clear, no write). Only used by getLaborState, so throwing is contained.
  return JSON.parse(await decryptField(await orgKey(), v.slice(ENC_PREFIX.length)));
}
async function encryptSettings(data) {
  const needs = ENC_SETTINGS_FIELDS.some((f) => data[f] != null);
  if (!needs) return data;
  try {
    const key = await orgKey();
    const out = { ...data };
    for (const f of ENC_SETTINGS_FIELDS) {
      if (f in out) {
        out[`${f}_enc`] = out[f] == null ? null : await encryptField(key, JSON.stringify(out[f]));
        delete out[f];
      }
    }
    return out;
  } catch { throw new Error(SECURE_UNAVAILABLE); } // fail-CLOSED: never store PII plaintext
}
async function decryptSettings(data) {
  if (!data) return {};
  const hasEnc = ENC_SETTINGS_FIELDS.some((f) => data[`${f}_enc`] != null);
  if (!hasEnc) return data;
  try {
    const key = await orgKey();
    const out = { ...data };
    for (const f of ENC_SETTINGS_FIELDS) {
      if (out[`${f}_enc`] != null) {
        try { out[f] = JSON.parse(await decryptField(key, out[`${f}_enc`])); } catch { /* leave field unset */ }
        delete out[`${f}_enc`];
      }
    }
    return out;
  } catch { return data; }
}

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

export async function getAuthUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOutEverywhere() {
  await supabase.auth.signOut({ scope: 'global' });
}

// ---- personal settings (own-row) ----
export async function getUserSettings() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data, error } = await supabase.from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return decryptSettings(data?.data || {});
}

export async function saveUserSettings(orgId, patch) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cur = await getUserSettings();          // decrypted plaintext
  const next = { ...cur, ...patch };
  const stored = await encryptSettings(next);   // encrypt sensitive PII at rest
  const { error } = await supabase.from('user_settings').upsert(
    { user_id: user.id, org_id: orgId || null, data: stored, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  if (error) throw error;
  return next;                                   // return plaintext to the app
}

// ---- two-factor (TOTP) ----
export async function mfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp || [];
}
export async function mfaEnroll() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error) throw error;
  return data; // { id, totp: { qr_code, secret, uri } }
}
export async function mfaVerify(factorId, code) {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error) throw ch.error;
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  if (error) throw error;
}
export async function mfaUnenroll(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

// compliance: gather the signed-in user's own data for export
export async function exportMyData(orgId) {
  const user = await getAuthUser();
  const out = { exported_at: new Date().toISOString(), account: { id: user?.id, email: user?.email }, org_id: orgId };
  try { out.settings = await getUserSettings(); } catch { /* skip */ }
  try {
    const { data } = await supabase.from('messages').select('channel, body, created_at').eq('sender_id', user.id);
    out.messages = data || [];
  } catch { /* skip */ }
  try {
    const { data } = await supabase.from('purchases').select('vendor, amount, note, status, created_at').eq('created_by', user.id);
    out.purchases = data || [];
  } catch { /* skip */ }
  return out;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session));
}

// ---- availability (on shift / off / PTO) ----
const avFromDb = (r) => ({ userId: r.user_id, label: r.label, status: r.status, note: r.note, updatedAt: r.updated_at });
export async function listAvailability(orgId) {
  const { data, error } = await supabase.from('availability').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data.map(avFromDb);
}
export async function setAvailability(orgId, { label, status, note }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('availability').upsert(
    { org_id: orgId, user_id: user.id, label, status, note: note || null, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,user_id' });
  if (error) throw error;
}
export function subscribeAvailability(orgId, cb) {
  const ch = supabase.channel('availability-' + orgId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability', filter: `org_id=eq.${orgId}` }, () => cb())
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---- audit log (sensitive actions) ----
export async function logAudit(orgId, action, target, actor, meta) {
  if (!orgId) return;
  try { await supabase.rpc('log_audit', { p_org: orgId, p_action: action, p_target: target || null, p_actor: actor || null, p_meta: meta || {} }); }
  catch { /* audit is best-effort, never blocks the action */ }
}
export async function listAudit(orgId, limit = 100) {
  const { data, error } = await supabase.from('audit_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, actor: r.actor, action: r.action, target: r.target, meta: r.meta, at: r.created_at }));
}

// ---- staff compliance view over contractor records ----
export async function orgMemberCompliance() {
  const { data, error } = await supabase.rpc('org_member_compliance');
  if (error) throw error;
  return (data || []).map((r) => ({ userId: r.user_id, email: r.email, role: r.role, certs: r.certs || [], tax: r.tax, emergency: r.emergency, updated: r.updated }));
}

// ---- invites & access management ----
const inviteFromDb = (r) => ({
  id: r.id, code: r.code, role: r.role, label: r.label, email: r.email,
  usedAt: r.used_at, expiresAt: r.expires_at, createdAt: r.created_at,
});

// short human-friendly code
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const b = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return s;
}

export async function createInvite(orgId, { role, label, email, expiresAt } = {}) {
  const code = makeCode();
  // default to a 14-day expiry so invite codes don't live forever
  const exp = expiresAt || new Date(Date.now() + 14 * 864e5).toISOString();
  const { data, error } = await supabase.from('invites').insert({
    org_id: orgId, code, role, label: label || null, email: email || null, expires_at: exp,
  }).select().single();
  if (error) throw error;
  return inviteFromDb(data);
}

export async function listInvites(orgId) {
  const { data, error } = await supabase.from('invites').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(inviteFromDb);
}

export async function revokeInvite(id) {
  const { error } = await supabase.from('invites').delete().eq('id', id);
  if (error) throw error;
}

// invitee redeems a code → gets placed into the org with the invite's role
export async function redeemInvite(code) {
  const { data, error } = await supabase.rpc('redeem_invite', { invite_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { orgId: row.org_id, role: row.role } : null;
}
// pre-auth peek at an invite so the login can brand itself (Portfolio vs Pro).
// Returns null on any error / not configured — the UI just falls back to Pro.
export async function inviteInfo(code) {
  if (!isConfigured() || !code) return null;
  try {
    const { data, error } = await supabase.rpc('invite_info', { p_code: code });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { valid: !!row.valid, kind: row.kind || 'company', orgName: row.org_name || null } : null;
  } catch { return null; }
}

export async function listOrgMembers() {
  const { data, error } = await supabase.rpc('org_members');
  if (error) throw error;
  return (data || []).map((r) => ({ userId: r.user_id, email: r.email, role: r.role, joined: r.joined }));
}

// the caller's org + role — drives which tools they can see.
// RLS enforces the same boundary server-side; this is for the UI.
export async function fetchMembership() {
  const { data, error } = await supabase
    .from('memberships').select('org_id, role, orgs(name, theme, kind)').limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { org_id: data.org_id, role: data.role, orgName: data.orgs?.name || null, theme: data.orgs?.theme || null, orgKind: data.orgs?.kind || 'company' };
}

// self-serve: create a workspace and become its admin
export async function createOrg(name, slug) {
  const { data, error } = await supabase.rpc('create_org', { org_name: name, org_slug: slug || null });
  if (error) throw error;
  return data; // new org id
}

export async function updateOrgName(orgId, name) {
  const { error } = await supabase.from('orgs').update({ name }).eq('id', orgId);
  if (error) throw error;
}

// ---- per-workspace branding: name + logo (logo lives in orgs.theme.logo) ----
// public read (name + logo) by org id — used by the unauthenticated resident page.
export async function getOrgBranding(orgId) {
  if (!isConfigured() || !orgId) return null;
  const { data, error } = await supabase.rpc('get_org_branding', { p_org_id: orgId });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  return r ? { name: r.name || null, logo: r.logo || null } : null;
}
// public building list by org id — for the unauthenticated resident form's
// property dropdown. Returns names only.
export async function getOrgProperties(orgId) {
  if (!isConfigured() || !orgId) return [];
  const { data, error } = await supabase.rpc('get_org_properties', { p_org_id: orgId });
  if (error) return [];
  return (data || []).map((r) => r.name).filter(Boolean);
}
// ---- Caliper Community · Slice 1: resident accounts + verify queue ----
const residentFromDb = (r) => ({
  id: r.id, userId: r.user_id, orgId: r.org_id, propLabel: r.property_label,
  unit: r.unit_label, name: r.display_name, email: r.email, status: r.status,
  createdAt: r.created_at, verifiedAt: r.verified_at,
});
// the signed-in user's residency (if any) — drives the resident shell
export async function getMyResident() {
  if (!isConfigured()) return null;
  const { data, error } = await supabase.from('residents').select('*')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return residentFromDb(data);
}
// claim a unit in an org — always lands as 'pending' for the office to verify
export async function claimResidency(orgId, { propLabel, unit, name, email }) {
  const { data, error } = await supabase.from('residents').insert({
    user_id: (await supabase.auth.getUser()).data.user?.id,
    org_id: orgId, property_label: propLabel || null, unit_label: unit || null,
    display_name: name || null, email: email || null, status: 'pending',
  }).select().single();
  if (error) throw error;
  return residentFromDb(data);
}
// the caller's own requests with live work-order status (definer fn — residents
// can never read work_orders directly)
export async function listMyRequests() {
  const { data, error } = await supabase.rpc('get_my_requests');
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, propLabel: r.property_label, unit: r.unit, description: r.description,
    status: r.status, woStatus: r.wo_status, createdAt: r.created_at,
  }));
}
// office: roster + verify queue
export async function listResidents(orgId) {
  const { data, error } = await supabase.from('residents').select('*')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(residentFromDb);
}
export async function setResidentStatus(id, status) {
  const patch = { status };
  if (status === 'verified') {
    patch.verified_by = (await supabase.auth.getUser()).data.user?.id || null;
    patch.verified_at = new Date().toISOString();
  }
  const { error } = await supabase.from('residents').update(patch).eq('id', id);
  if (error) throw error;
}
// announcements: office posts, residents read
const annFromDb = (a) => ({ id: a.id, title: a.title, body: a.body || '', urgent: !!a.urgent, createdAt: a.created_at });
export async function listAnnouncements(orgId) {
  const { data, error } = await supabase.from('org_announcements').select('*')
    .eq('org_id', orgId).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []).map(annFromDb);
}
export async function postAnnouncement(orgId, { title, body, urgent }) {
  const { data, error } = await supabase.from('org_announcements')
    .insert({ org_id: orgId, title, body: body || null, urgent: !!urgent }).select().single();
  if (error) throw error;
  return annFromDb(data);
}
export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('org_announcements').delete().eq('id', id);
  if (error) throw error;
}

// upload a workspace logo to the public brand-logos bucket → returns its URL.
export async function uploadBrandLogo(orgId, file) {
  const ext = ((file.name || '').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${orgId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('brand-logos').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return supabase.storage.from('brand-logos').getPublicUrl(path).data.publicUrl;
}
// set (or clear, with null) the workspace logo on orgs.theme, preserving the rest of the theme.
export async function setOrgLogo(orgId, logoUrl) {
  const { data: cur } = await supabase.from('orgs').select('theme').eq('id', orgId).maybeSingle();
  const theme = { ...(cur?.theme || {}) };
  if (logoUrl) theme.logo = logoUrl; else delete theme.logo;
  const { error } = await supabase.from('orgs').update({ theme }).eq('id', orgId);
  if (error) throw error;
  return theme;
}

// ---- platform superadmin (cross-tenant, gated by is_platform_admin) ----
export async function isPlatformAdmin() {
  if (!isConfigured()) return false;
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) return false;
  return !!data;
}
export async function adminListOrgs() {
  const { data, error } = await supabase.rpc('admin_list_orgs');
  if (error) throw error;
  return (data || []).map((o) => ({ id: o.id, name: o.name, createdAt: o.created_at, members: Number(o.members) }));
}
export async function adminCreateWorkspace(name, ownerEmail, kind = 'company') {
  const { data, error } = await supabase.rpc('admin_create_workspace', { p_name: name, p_owner_email: ownerEmail || null, p_kind: kind });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return { orgId: r?.org_id, code: r?.invite_code };
}
export async function listWorkspaceRequests() {
  const { data, error } = await supabase.from('workspace_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, email: r.email, contactName: r.contact_name, orgName: r.org_name, note: r.note, kind: r.kind || 'company', status: r.status, code: r.invite_code, createdAt: r.created_at, decidedBy: r.decided_by }));
}
export async function decideWorkspaceRequest(id, approve) {
  const { data, error } = await supabase.rpc('admin_decide_request', { p_id: id, p_approve: approve });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  return r?.org_id ? { orgId: r.org_id, code: r.invite_code } : null;
}
// public beta-invite request — works pre-auth (anon). Email required.
export async function requestBeta({ email, contactName, orgName, kind = 'company', note } = {}) {
  let mail = email;
  if (!mail) { try { const { data: { user } } = await supabase.auth.getUser(); mail = user?.email || null; } catch { /* anon */ } }
  const { error } = await supabase.from('workspace_requests').insert({
    email: mail, contact_name: contactName || null, org_name: orgName || (contactName ? `${contactName}'s workspace` : 'New workspace'),
    kind, note: note || null,
  });
  if (error) throw error;
}

// ---- account deletion / erasure requests ----
export async function requestAccountDeletion(note) {
  const { error } = await supabase.rpc('request_account_deletion', { p_note: note || null });
  if (error) throw error;
}
export async function listDeletionRequests() {
  const { data, error } = await supabase.from('deletion_requests').select('*').eq('status', 'pending').order('requested_at');
  if (error) throw error;
  return (data || []).map((r) => ({ userId: r.user_id, email: r.email, note: r.note, requestedAt: r.requested_at }));
}
export async function resolveDeletionRequest(userId) {
  const { error } = await supabase.from('deletion_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('user_id', userId);
  if (error) throw error;
}

// ---- transactional email (best-effort; never blocks the app flow) ----
// The 'email' edge function degrades gracefully when Resend isn't configured,
// so these are fire-and-forget: a mail failure must never break signup or a
// workspace approval. Callers may ignore the resolved value.
export async function sendWelcomeEmail(name) {
  try {
    const { data, error } = await supabase.functions.invoke('email', { body: { type: 'welcome', name: name || null } });
    if (error) return { ok: false, error: error.message };
    return data || { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
export async function sendInviteEmail({ to, code, name, orgName } = {}) {
  if (!to) return { ok: false, error: 'no recipient' };
  try {
    const { data, error } = await supabase.functions.invoke('email', { body: { type: 'invite', to, code, name: name || null, orgName: orgName || null } });
    if (error) return { ok: false, error: error.message };
    return data || { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// ---- work orders ----
const woFromDb = (r) => ({
  id: r.id, propLabel: r.property_label, unit: r.unit, task: r.task,
  detail: r.detail, category: r.category, assigneeLabel: r.assignee_label,
  due: r.due_date, status: r.status, source: r.source, priority: r.priority ?? 3,
  transcript: r.voice_transcript, photos: r.photos || [], files: r.files || [], createdAt: r.created_at,
  // tenant billing (Service Log): what we charge, what it cost, billed state
  serviceFee: r.service_fee != null ? Number(r.service_fee) : null,
  repairCost: r.repair_cost != null ? Number(r.repair_cost) : null,
  tenantBilled: r.tenant_billed || 'no',
  checklist: Array.isArray(r.checklist) ? r.checklist : null,   // templated task list (v43)
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
    checklist: Array.isArray(wo.checklist) && wo.checklist.length ? wo.checklist : null,
    photos: Array.isArray(wo.photos) && wo.photos.length ? wo.photos : undefined,
  }).select().single();
  if (error) throw error;
  return woFromDb(data);
}

export async function updateWorkOrderStatus(id, status) {
  const { error } = await supabase.from('work_orders').update({ status }).eq('id', id);
  if (error) throw error;
}

// checklist on a work order — array of { id, text, done, doneAt }. Tolerates a
// DB without the column (pre-v43): the update simply no-ops on schema error.
export async function updateWorkOrderChecklist(id, checklist) {
  const { error } = await supabase.from('work_orders')
    .update({ checklist: Array.isArray(checklist) ? checklist : [] }).eq('id', id);
  if (error) throw error;
}

// ---- preventive / recurring maintenance schedules ----
const maintFromDb = (r) => ({
  id: r.id, propLabel: r.property_label, unit: r.unit, task: r.task, detail: r.detail,
  category: r.category, intervalDays: Number(r.interval_days) || 30, nextDue: r.next_due,
  assigneeLabel: r.assignee_label, priority: r.priority ?? 3, active: r.active !== false,
  lastGenerated: r.last_generated || null, createdAt: r.created_at,
});
const maintToDb = (s) => ({
  property_label: s.propLabel || null, unit: s.unit || null, task: s.task, detail: s.detail || null,
  category: s.category || 'general', interval_days: Number(s.intervalDays) || 30, next_due: s.nextDue,
  assignee_label: s.assigneeLabel || null, priority: s.priority ?? 3, active: s.active !== false,
});
export async function listMaintenanceSchedules(orgId) {
  const { data, error } = await supabase.from('maintenance_schedules').select('*')
    .eq('org_id', orgId).order('next_due', { ascending: true });
  if (error) throw error;
  return (data || []).map(maintFromDb);
}
export async function insertMaintenanceSchedule(orgId, s) {
  const { data, error } = await supabase.from('maintenance_schedules')
    .insert({ org_id: orgId, ...maintToDb(s) }).select().single();
  if (error) throw error;
  return maintFromDb(data);
}
export async function updateMaintenanceSchedule(id, patch) {
  const db = {};
  if ('propLabel' in patch) db.property_label = patch.propLabel || null;
  if ('unit' in patch) db.unit = patch.unit || null;
  if ('task' in patch) db.task = patch.task;
  if ('detail' in patch) db.detail = patch.detail || null;
  if ('category' in patch) db.category = patch.category || 'general';
  if ('intervalDays' in patch) db.interval_days = Number(patch.intervalDays) || 30;
  if ('nextDue' in patch) db.next_due = patch.nextDue;
  if ('assigneeLabel' in patch) db.assignee_label = patch.assigneeLabel || null;
  if ('priority' in patch) db.priority = patch.priority ?? 3;
  if ('active' in patch) db.active = patch.active !== false;
  if ('lastGenerated' in patch) db.last_generated = patch.lastGenerated;
  const { error } = await supabase.from('maintenance_schedules').update(db).eq('id', id);
  if (error) throw error;
}
export async function deleteMaintenanceSchedule(id) {
  const { error } = await supabase.from('maintenance_schedules').delete().eq('id', id);
  if (error) throw error;
}

// ---- resident maintenance requests (public intake → office triage → work order) ----
const reqFromDb = (r) => ({
  id: r.id, propLabel: r.property_label, unit: r.unit, tenantName: r.tenant_name,
  tenantContact: r.tenant_contact, description: r.description, photo: r.photo || null,
  // multi-photo (v44); fall back to the single legacy photo so old rows still show
  photos: Array.isArray(r.photos) && r.photos.length ? r.photos : (r.photo ? [r.photo] : []),
  voice: r.voice || null,
  status: r.status, workOrderId: r.work_order_id, createdAt: r.created_at,
});
// submit a request. Callable by an UNAUTHENTICATED resident (anon key) — the
// mr_public_insert RLS policy allows the insert; they can't read anything back.
export async function submitMaintenanceRequest(orgId, r) {
  const photos = Array.isArray(r.photos) ? r.photos.filter(Boolean) : (r.photo ? [r.photo] : []);
  const { error } = await supabase.from('maintenance_requests').insert({
    org_id: orgId, property_label: r.propLabel || null, unit: r.unit || null,
    tenant_name: r.tenantName || null, tenant_contact: r.tenantContact || null,
    description: r.description,
    photo: photos[0] || null,           // keep the single column populated (first photo)
    photos: photos.length ? photos : null,
    voice: r.voice || null,
    resident_id: r.residentId || null,  // verified-account path (guard enforces ownership)
  });
  if (error) throw error;
}
export async function listMaintenanceRequests(orgId) {
  const { data, error } = await supabase.from('maintenance_requests').select('*')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(reqFromDb);
}
export async function updateMaintenanceRequest(id, patch) {
  const db = {};
  if ('status' in patch) db.status = patch.status;
  if ('workOrderId' in patch) db.work_order_id = patch.workOrderId;
  const { error } = await supabase.from('maintenance_requests').update(db).eq('id', id);
  if (error) throw error;
}
export function subscribeMaintenanceRequests(orgId, cb) {
  const ch = supabase.channel(`mreq-${orgId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests', filter: `org_id=eq.${orgId}` }, () => cb())
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---- checklist templates (reusable task lists for work orders + turns) ----
const tmplFromDb = (r) => ({
  id: r.id, name: r.name, kind: r.kind || 'any', category: r.category || null,
  items: Array.isArray(r.items) ? r.items : [], createdAt: r.created_at,
});
export async function listChecklistTemplates(orgId) {
  const { data, error } = await supabase.from('checklist_templates').select('*')
    .eq('org_id', orgId).order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(tmplFromDb);
}
export async function insertChecklistTemplate(orgId, t) {
  const { data, error } = await supabase.from('checklist_templates').insert({
    org_id: orgId, name: t.name, kind: t.kind || 'any', category: t.category || null,
    items: Array.isArray(t.items) ? t.items : [],
  }).select().single();
  if (error) throw error;
  return tmplFromDb(data);
}
export async function updateChecklistTemplate(id, patch) {
  const db = {};
  if ('name' in patch) db.name = patch.name;
  if ('kind' in patch) db.kind = patch.kind || 'any';
  if ('category' in patch) db.category = patch.category || null;
  if ('items' in patch) db.items = Array.isArray(patch.items) ? patch.items : [];
  const { error } = await supabase.from('checklist_templates').update(db).eq('id', id);
  if (error) throw error;
}
export async function deleteChecklistTemplate(id) {
  const { error } = await supabase.from('checklist_templates').delete().eq('id', id);
  if (error) throw error;
}

// ---- unit turns (make-ready / turnover board) ----
const turnFromDb = (r) => ({
  id: r.id, propLabel: r.property_label, unit: r.unit, stage: r.stage || 'notice',
  moveOut: r.move_out, targetReady: r.target_ready, actualReady: r.actual_ready,
  assigneeLabel: r.assignee_label, marketRent: r.market_rent != null ? Number(r.market_rent) : null,
  checklist: Array.isArray(r.checklist) ? r.checklist : null, notes: r.notes || null,
  workOrderId: r.work_order_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const turnToDb = (t) => ({
  property_label: t.propLabel || null, unit: t.unit || null, stage: t.stage || 'notice',
  move_out: t.moveOut || null, target_ready: t.targetReady || null, actual_ready: t.actualReady || null,
  assignee_label: t.assigneeLabel || null,
  market_rent: t.marketRent === '' || t.marketRent == null ? null : Number(t.marketRent),
  checklist: Array.isArray(t.checklist) ? t.checklist : null, notes: t.notes || null,
  work_order_id: t.workOrderId || null,
});
export async function listUnitTurns(orgId) {
  const { data, error } = await supabase.from('unit_turns').select('*')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(turnFromDb);
}
export async function insertUnitTurn(orgId, t) {
  const { data, error } = await supabase.from('unit_turns')
    .insert({ org_id: orgId, ...turnToDb(t) }).select().single();
  if (error) throw error;
  return turnFromDb(data);
}
export async function updateUnitTurn(id, patch) {
  const full = turnToDb(patch);
  const db = { updated_at: new Date().toISOString() };
  // only send keys the caller actually provided (patch semantics)
  const MAP = {
    propLabel: 'property_label', unit: 'unit', stage: 'stage', moveOut: 'move_out',
    targetReady: 'target_ready', actualReady: 'actual_ready', assigneeLabel: 'assignee_label',
    marketRent: 'market_rent', checklist: 'checklist', notes: 'notes', workOrderId: 'work_order_id',
  };
  for (const k of Object.keys(patch)) if (MAP[k]) db[MAP[k]] = full[MAP[k]];
  const { error } = await supabase.from('unit_turns').update(db).eq('id', id);
  if (error) throw error;
}
export async function deleteUnitTurn(id) {
  const { error } = await supabase.from('unit_turns').delete().eq('id', id);
  if (error) throw error;
}
export function subscribeUnitTurns(orgId, cb) {
  const ch = supabase.channel(`turns-${orgId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'unit_turns', filter: `org_id=eq.${orgId}` }, () => cb())
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---- cross-device field-timer state (running + parked jobs, one row per user) ----
export async function getFieldState(orgId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('field_timer_state')
    .select('state, updated_at').eq('org_id', orgId).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data ? { state: data.state || {}, updatedAt: data.updated_at } : null;
}
export async function upsertFieldState(orgId, state) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('field_timer_state')
    .upsert({ org_id: orgId, user_id: user.id, state, updated_at: new Date().toISOString() }, { onConflict: 'org_id,user_id' });
  if (error) throw error;
}
// subscribe to field-timer rows in an org. userId set → only that user's row (cb
// gets the row); userId null → every row (for the office board). Echo-guarded by
// the caller via state.rev.
export function subscribeFieldState(orgId, userId, cb) {
  const ch = supabase.channel(`fts-${orgId}-${userId || 'all'}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'field_timer_state', filter: `org_id=eq.${orgId}` },
      (payload) => { const r = payload.new; if (r && (!userId || r.user_id === userId)) cb(r); })
    .subscribe();
  return () => supabase.removeChannel(ch);
}
// office: every operator's running + parked state
export async function listFieldStates(orgId) {
  const { data, error } = await supabase.from('field_timer_state').select('user_id, state, updated_at').eq('org_id', orgId);
  if (error) throw error;
  return (data || []).map((r) => ({ userId: r.user_id, state: r.state || {}, updatedAt: r.updated_at }));
}

export async function updateWorkOrderPriority(id, priority) {
  const { error } = await supabase.from('work_orders').update({ priority }).eq('id', id);
  if (error) throw error;
}

export async function updateWorkOrderAssignee(id, assigneeLabel) {
  const { error } = await supabase.from('work_orders').update({ assignee_label: assigneeLabel }).eq('id', id);
  if (error) throw error;
}

// tenant billing on a work order — service fee, repair cost, billed state.
// Tolerates a DB without the billing columns (added in 0032) so nothing
// regresses before the migration lands.
export async function updateWorkOrderBilling(id, patch) {
  const upd = {};
  if (patch.serviceFee !== undefined) upd.service_fee = patch.serviceFee;
  if (patch.repairCost !== undefined) upd.repair_cost = patch.repairCost;
  if (patch.tenantBilled !== undefined) upd.tenant_billed = patch.tenantBilled;
  if (!Object.keys(upd).length) return;
  const { error } = await supabase.from('work_orders').update(upd).eq('id', id);
  // tolerate a DB without the 0032 billing columns, but ONLY for a genuine
  // missing-column error — a substring match on "column" would also swallow
  // not-null/constraint violations and silently drop a real write.
  if (error && (error.code === 'PGRST204' || error.code === '42703' || /schema cache|does not exist/i.test(error.message || ''))) return;
  if (error) throw error;
}

export async function updateWorkOrderPhotos(id, photos) {
  const { error } = await supabase.from('work_orders').update({ photos }).eq('id', id);
  if (error) throw error;
}

export async function updateWorkOrderFiles(id, files) {
  const { error } = await supabase.from('work_orders').update({ files }).eq('id', id);
  if (error) throw error;
}

// shared upload for work-order photos + chat images → returns the object path
export async function uploadAttachment(orgId, file) {
  const ext = (file.name?.split('.').pop() || (file.type.split('/')[1] || 'jpg')).replace(/[^\w]+/g, '').slice(0, 5);
  const path = `${orgId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return path;
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
  body: r.body, voicePath: r.voice_path, voiceSecs: r.voice_secs, imagePath: r.image_path,
  filePath: r.file_path, fileName: r.file_name,
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
    image_path: m.imagePath || null, file_path: m.filePath || null, file_name: m.fileName || null,
    sender_id: user?.id, sender_label: m.sender || null, sender_role: m.senderRole || null,
  }).select().single();
  if (error) throw error;
  return msgFromDb(data);
}

// unsend: remove a message row. RLS (msg_delete) lets the sender delete their
// own and org staff moderate any; a blocked delete surfaces as an error.
export async function deleteMessage(id) {
  const { error } = await supabase.from('messages').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeMessages(orgId, onInsert, onDelete) {
  const ch = supabase.channel('msg-live-' + orgId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${orgId}` },
      (payload) => onInsert(msgFromDb(payload.new)))
    // a DELETE payload carries only the primary key (replica identity default),
    // which is all we need to drop it from every open thread live.
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => onDelete && payload.old?.id && onDelete(payload.old.id))
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // filter server-side so a large operator roster can never bury the caller's
  // own row past a client-side limit (which would leave them unable to sync).
  // Ignore an inactive seat: a member whose field work was turned off keeps their
  // history but can't log new time (and won't see the Field tab).
  const { data, error } = await supabase
    .from('operators').select('id').eq('user_id', user.id).neq('status', 'inactive').limit(1).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

// give an office member (or reactivate) an operator seat so they can do field
// work too — their labor then attributes to this seat in crew + office views.
// Staff-only via the op_staff RLS policy (is_org_staff).
export async function enableFieldWork(orgId, { userId, name, rate }) {
  const { data: existing } = await supabase
    .from('operators').select('id').eq('org_id', orgId).eq('user_id', userId).limit(1).maybeSingle();
  if (existing?.id) {
    const patch = { status: 'active' };
    if (name) patch.display_name = name;
    if (rate != null) patch.hourly_rate = Number(rate);
    const { error } = await supabase.from('operators').update(patch).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase.from('operators').insert({
    org_id: orgId, user_id: userId, display_name: name || null,
    role: 'tech', status: 'active', hourly_rate: rate == null ? null : Number(rate),
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

// turn off field work for a member: deactivate their seat (keeps labor history).
export async function disableFieldWork(orgId, userId) {
  const { error } = await supabase.from('operators')
    .update({ status: 'inactive' }).eq('org_id', orgId).eq('user_id', userId);
  if (error) throw error;
}

export async function insertTimer(orgId, operatorId, t) {
  const base = {
    org_id: orgId, operator_id: operatorId,
    property_label: t.propLabel || null, unit: t.unit || null,
    work_date: t.date, category: t.category || 'general',
    issue: t.issue || null, duration_hrs: t.durationHrs,
    note: t.note || null, work_order_id: t.workOrderId || null, source: 'timer',
  };
  // verified clock-in: the punch location + whether it landed inside the fence.
  // Tolerate a DB without the 0030 geo columns so timers still sync (no regression).
  const withGeo = { ...base, gps_lat: t.gpsLat ?? null, gps_lng: t.gpsLng ?? null, verified: t.verified ?? null, distance_m: t.distanceM ?? null };
  let { data, error } = await supabase.from('timers').insert(withGeo).select('id').single();
  if (error && /gps_lat|gps_lng|verified|distance_m|column/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('timers').insert(base).select('id').single());
  }
  if (error) throw error;
  return data.id;
}

// map a timers-table row to the editable timesheet shape the crew/office see
const tsFromDb = (r) => ({
  id: r.id, dbId: r.id, operatorId: r.operator_id, techId: r.operator_id,
  date: r.work_date, createdAt: r.created_at,
  propLabel: r.property_label || '', unit: r.unit || '',
  category: r.category || 'general', note: r.note || r.issue || '',
  durationHrs: Number(r.duration_hrs) || 0, workOrderId: r.work_order_id || null,
  verified: r.verified ?? null, distanceM: r.distance_m ?? null, rate: 0, source: r.source || 'timer',
});

// the timesheet history. RLS scopes it for free: office sees every org row,
// a tech sees only their own — one query, correct for both.
export async function listTimers(orgId, { limit = 1000 } = {}) {
  const { data, error } = await supabase.from('timers').select('*')
    .eq('org_id', orgId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map(tsFromDb);
}

// remove a logged entry (RLS: office any row, tech their own)
export async function deleteTimer(id) {
  const { error } = await supabase.from('timers').delete().eq('id', id);
  if (error) throw error;
}

// edit a previously-logged timer (RLS: a tech may update only their own rows)
export async function updateTimer(id, patch) {
  const upd = {};
  if (patch.propLabel !== undefined) upd.property_label = patch.propLabel || null;
  if (patch.unit !== undefined) upd.unit = patch.unit || null;
  if (patch.category !== undefined) upd.category = patch.category || 'general';
  if (patch.durationHrs !== undefined) upd.duration_hrs = patch.durationHrs;
  if (patch.note !== undefined) { upd.note = patch.note || null; upd.issue = patch.note || null; }
  if (patch.date !== undefined) upd.work_date = patch.date;
  const { error } = await supabase.from('timers').update(upd).eq('id', id);
  if (error) throw error;
}

// ---- purchases (material receipts) ----
const purFromDb = (r) => ({
  id: r.id, workOrderId: r.work_order_id, propLabel: r.property_label,
  vendor: r.vendor, amount: Number(r.amount), note: r.note,
  receiptPath: r.receipt_path, status: r.status, lineItems: r.line_items || null,
  submittedBy: r.submitted_by_label, createdAt: r.created_at,
  // the receipt's actual purchase date (what the P&L should bucket by); falls
  // back to the entry timestamp for legacy rows or an unscanned date.
  date: r.purchase_date || (r.created_at ? String(r.created_at).slice(0, 10) : null),
});

export async function listPurchases(orgId) {
  const { data, error } = await supabase
    .from('purchases').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(purFromDb);
}

export async function insertPurchase(orgId, p) {
  const base = {
    org_id: orgId, work_order_id: p.workOrderId || null,
    property_label: p.propLabel || null, vendor: p.vendor || null,
    amount: p.amount, note: p.note || null, receipt_path: p.receiptPath || null,
    line_items: p.lineItems || null, submitted_by_label: p.submittedBy || null,
  };
  // carry the scanned purchase date; tolerate a DB that hasn't run 0038 yet so
  // receipts still save (they just fall back to created_at for month bucketing).
  const withDate = { ...base, purchase_date: p.date || null };
  let { data, error } = await supabase.from('purchases').insert(withDate).select().single();
  if (error && /purchase_date|column/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('purchases').insert(base).select().single());
  }
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

// ---- leasing: units + their current lease (the rent-roll spine) ----
const leaseUnitFromDb = (u) => {
  const ls = u.leases || [];
  const l = ls.find((x) => x.active) || ls[0] || null;
  return {
    id: u.id, propertyId: u.property_id, building: u.building || '', number: u.name,
    beds: u.beds != null ? Number(u.beds) : null, type: u.unit_type || 'residential',
    sqft: u.sqft, furnished: !!u.furnished, status: u.status || 'vacant', sort: u.sort || 0,
    leaseId: l?.id || null, tenant: l?.tenant_name || '', phone: l?.tenant_phone || '',
    rent: l?.rent != null ? Number(l.rent) : null, fees: l?.fees || {},
    total: l?.total != null ? Number(l.total) : null, deposit: l?.deposit != null ? Number(l.deposit) : null,
    leaseStart: l?.lease_start || null, leaseEnd: l?.lease_end || null,
    renewalStatus: l?.renewal_status || null, notes: l?.notes || '',
  };
};

export async function listLeasing(orgId) {
  const { data, error } = await supabase.from('units')
    .select('*, leases(*)').eq('org_id', orgId).order('sort', { ascending: true });
  if (error) throw error;
  const rows = (data || []).map(leaseUnitFromDb);
  // decrypt tenant PII (dual-mode: legacy plaintext passes straight through)
  return Promise.all(rows.map(async (r) => ({ ...r, tenant: await decStr(r.tenant), phone: await decStr(r.phone) })));
}

export async function updateLeaseRow(leaseId, patch) {
  const upd = {};
  if (patch.rent !== undefined) upd.rent = patch.rent;
  if (patch.renewalStatus !== undefined) upd.renewal_status = patch.renewalStatus;
  if (patch.notes !== undefined) upd.notes = patch.notes;
  // skip when the field still shows the decrypt mask — the user never saw the real
  // value (KMS was down), so persisting it would encrypt '•••' over the real PII
  if (patch.tenant !== undefined && patch.tenant !== DEC_MASK) upd.tenant_name = patch.tenant ? await encStr(patch.tenant) : null;
  if (patch.phone !== undefined && patch.phone !== DEC_MASK) upd.tenant_phone = patch.phone ? await encStr(patch.phone) : null;
  if (patch.deposit !== undefined) upd.deposit = patch.deposit;
  if (patch.leaseStart !== undefined) upd.lease_start = patch.leaseStart || null;
  if (patch.leaseEnd !== undefined) upd.lease_end = patch.leaseEnd || null;
  const { error } = await supabase.from('leases').update(upd).eq('id', leaseId);
  if (error) throw error;
}

export async function updateUnitRow(unitId, patch) {
  const upd = {};
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.number !== undefined) upd.name = patch.number;
  if (patch.beds !== undefined) upd.beds = patch.beds;
  if (patch.type !== undefined) upd.unit_type = patch.type;
  if (patch.furnished !== undefined) upd.furnished = !!patch.furnished;
  if (patch.sqft !== undefined) upd.sqft = patch.sqft;
  const { error } = await supabase.from('units').update(upd).eq('id', unitId);
  if (error) throw error;
}

// create a unit (+ its lease) in a building; resolves/creates the property
export async function addUnitWithLease(orgId, u) {
  let pid = u.propertyId || null;
  if (!pid && u.building) {
    const { data: p } = await supabase.from('properties').select('id').eq('org_id', orgId).ilike('name', u.building).limit(1).maybeSingle();
    pid = p?.id || null;
    if (!pid) { const { data: np } = await supabase.from('properties').insert({ org_id: orgId, name: u.building, units: 1 }).select('id').single(); pid = np?.id || null; }
  }
  const { data: nu, error } = await supabase.from('units').insert({
    org_id: orgId, property_id: pid, building: u.building || null, name: u.number || 'New unit',
    beds: u.beds ?? null, unit_type: u.type || 'residential', furnished: !!u.furnished,
    status: u.status || 'vacant', sort: u.sort ?? 999,
  }).select('*').single();
  if (error) throw error;
  const { data: nl } = await supabase.from('leases').insert({
    org_id: orgId, unit_id: nu.id,
    tenant_name: u.tenant ? await encStr(u.tenant) : null, tenant_phone: u.phone ? await encStr(u.phone) : null,
    rent: u.rent ?? null, fees: u.fees || {}, deposit: u.deposit ?? null,
    lease_start: u.leaseStart || null, lease_end: u.leaseEnd || null, active: true,
  }).select('*').single();
  const row = leaseUnitFromDb({ ...nu, leases: nl ? [nl] : [] });
  return { ...row, tenant: u.tenant || '', phone: u.phone || '' }; // return plaintext to the app
}

// wipe the whole rent roll for an org (units + their leases via cascade). Buildings
// (properties rows) stay, so a re-import reuses them by name. Staff-only via RLS.
export async function clearLeasing(orgId) {
  const { error } = await supabase.from('units').delete().eq('org_id', orgId);
  if (error) throw error;
}

export async function deleteUnit(unitId) {
  const { error } = await supabase.from('units').delete().eq('id', unitId);   // leases cascade
  if (error) throw error;
}

// ---- vendors: approved contractors / suppliers + favorite products ----
const vendorFromDb = (r) => ({
  id: r.id, name: r.name, kind: r.kind || 'contractor', trade: r.trade || '',
  contactName: r.contact_name || '', phone: r.phone || '', email: r.email || '',
  website: r.website || '', address: r.address || '', license: r.license || '',
  rating: r.rating ?? null, approved: r.approved !== false, favorite: !!r.favorite,
  notes: r.notes || '', createdAt: r.created_at,
});
const vendorToDb = (v) => ({
  name: v.name, kind: v.kind || 'contractor', trade: v.trade || null,
  contact_name: v.contactName || null, phone: v.phone || null, email: v.email || null,
  website: v.website || null, address: v.address || null, license: v.license || null,
  rating: v.rating ?? null, approved: v.approved !== false, favorite: !!v.favorite,
  notes: v.notes || null,
});
// PATCH semantics for updates — emit only the columns present in the patch, so a
// single-field edit (e.g. toggling favorite) can't revert a concurrent edit to
// another field (audit #16). Full-record form saves still pass every key.
const vendorPatchToDb = (p) => {
  const o = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.kind !== undefined) o.kind = p.kind || 'contractor';
  if (p.trade !== undefined) o.trade = p.trade || null;
  if (p.contactName !== undefined) o.contact_name = p.contactName || null;
  if (p.phone !== undefined) o.phone = p.phone || null;
  if (p.email !== undefined) o.email = p.email || null;
  if (p.website !== undefined) o.website = p.website || null;
  if (p.address !== undefined) o.address = p.address || null;
  if (p.license !== undefined) o.license = p.license || null;
  if (p.rating !== undefined) o.rating = p.rating ?? null;
  if (p.approved !== undefined) o.approved = p.approved !== false;
  if (p.favorite !== undefined) o.favorite = !!p.favorite;
  if (p.notes !== undefined) o.notes = p.notes || null;
  return o;
};
const productFromDb = (r) => ({
  id: r.id, vendorId: r.vendor_id || null, name: r.name, category: r.category || '',
  sku: r.sku || '', price: r.price ?? null, url: r.url || '', favorite: r.favorite !== false,
  notes: r.notes || '', createdAt: r.created_at,
});
const productToDb = (p) => ({
  vendor_id: p.vendorId || null, name: p.name, category: p.category || null,
  sku: p.sku || null, price: p.price ?? null, url: p.url || null,
  favorite: p.favorite !== false, notes: p.notes || null,
});

export async function listVendors(orgId) {
  const { data, error } = await supabase.from('vendors').select('*').eq('org_id', orgId).order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(vendorFromDb);
}
export async function addVendor(orgId, v) {
  const { data, error } = await supabase.from('vendors').insert({ org_id: orgId, ...vendorToDb(v) }).select('*').single();
  if (error) throw error;
  return vendorFromDb(data);
}
export async function updateVendor(id, patch) {
  const { error } = await supabase.from('vendors').update(vendorPatchToDb(patch)).eq('id', id);
  if (error) throw error;
}
export async function deleteVendor(id) {
  const { error } = await supabase.from('vendors').delete().eq('id', id);
  if (error) throw error;
}
// ---- Certificate of Insurance (COI) ----
const coiFromDb = (r) => ({
  id: r.id, holderType: r.holder_type, holderRef: r.holder_ref, holderName: r.holder_name,
  building: r.building, unit: r.unit, carrier: r.carrier, policyNumber: r.policy_number,
  coverage: r.coverage || {}, effective: r.effective, expires: r.expires,
  additionalInsured: !!r.additional_insured, docUrl: r.doc_url, notes: r.notes,
});
const coiToDb = (c) => {
  const o = {};
  if (c.holderType !== undefined) o.holder_type = c.holderType;
  if (c.holderRef !== undefined) o.holder_ref = c.holderRef;
  if (c.holderName !== undefined) o.holder_name = c.holderName;
  if (c.building !== undefined) o.building = c.building;
  if (c.unit !== undefined) o.unit = c.unit;
  if (c.carrier !== undefined) o.carrier = c.carrier;
  if (c.policyNumber !== undefined) o.policy_number = c.policyNumber;
  if (c.coverage !== undefined) o.coverage = c.coverage;
  if (c.effective !== undefined) o.effective = c.effective || null;
  if (c.expires !== undefined) o.expires = c.expires || null;
  if (c.additionalInsured !== undefined) o.additional_insured = !!c.additionalInsured;
  if (c.docUrl !== undefined) o.doc_url = c.docUrl;
  if (c.notes !== undefined) o.notes = c.notes;
  return o;
};
export async function listCois(orgId) {
  // resilient: if the migration isn't applied yet, don't crash the app — just show none
  const { data, error } = await supabase.from('insurance_certificates').select('*').eq('org_id', orgId).order('expires', { ascending: true });
  if (error) return [];
  return (data || []).map(coiFromDb);
}
export async function addCoi(orgId, c) {
  const { data, error } = await supabase.from('insurance_certificates').insert({ org_id: orgId, ...coiToDb(c) }).select('*').single();
  if (error) throw error;
  return coiFromDb(data);
}
export async function updateCoi(id, patch) {
  const { error } = await supabase.from('insurance_certificates').update(coiToDb(patch)).eq('id', id);
  if (error) throw error;
}
export async function deleteCoi(id) {
  const { error } = await supabase.from('insurance_certificates').delete().eq('id', id);
  if (error) throw error;
}

// ---- Building Handbook ----
const handbookFromDb = (r) => ({ id: r.id, building: r.building, sections: r.sections || [], updatedAt: r.updated_at });
export async function listHandbooks(orgId) {
  // resilient if the migration isn't applied yet
  const { data, error } = await supabase.from('building_handbooks').select('*').eq('org_id', orgId);
  if (error) return [];
  return (data || []).map(handbookFromDb);
}
export async function getHandbook(orgId, building) {
  const { data, error } = await supabase.from('building_handbooks').select('*').eq('org_id', orgId).eq('building', building).maybeSingle();
  if (error || !data) return null;
  return handbookFromDb(data);
}
export async function saveHandbook(orgId, building, sections) {
  const { data, error } = await supabase.from('building_handbooks')
    .upsert({ org_id: orgId, building, sections, updated_at: new Date().toISOString() }, { onConflict: 'org_id,building' })
    .select('*').single();
  if (error) throw error;
  return handbookFromDb(data);
}

// ---- Inspections ----
const inspFromDb = (r) => ({ id: r.id, building: r.building, unit: r.unit, title: r.title, kind: r.kind, status: r.status, items: r.items || [], inspector: r.inspector, date: r.date, notes: r.notes });
const inspToDb = (i) => {
  const o = {};
  if (i.building !== undefined) o.building = i.building;
  if (i.unit !== undefined) o.unit = i.unit;
  if (i.title !== undefined) o.title = i.title;
  if (i.kind !== undefined) o.kind = i.kind;
  if (i.status !== undefined) o.status = i.status;
  if (i.items !== undefined) o.items = i.items;
  if (i.inspector !== undefined) o.inspector = i.inspector;
  if (i.date !== undefined) o.date = i.date || null;
  if (i.notes !== undefined) o.notes = i.notes;
  return o;
};
export async function listInspections(orgId) {
  const { data, error } = await supabase.from('inspections').select('*').eq('org_id', orgId).order('date', { ascending: false });
  if (error) return [];
  return (data || []).map(inspFromDb);
}
export async function addInspection(orgId, i) {
  const { data, error } = await supabase.from('inspections').insert({ org_id: orgId, ...inspToDb(i) }).select('*').single();
  if (error) throw error;
  return inspFromDb(data);
}
export async function updateInspection(id, patch) {
  const { error } = await supabase.from('inspections').update(inspToDb(patch)).eq('id', id);
  if (error) throw error;
}
export async function deleteInspection(id) {
  const { error } = await supabase.from('inspections').delete().eq('id', id);
  if (error) throw error;
}

// ---- Amenities + reservations ----
const amenityFromDb = (r) => ({ id: r.id, building: r.building, name: r.name, description: r.description, capacity: r.capacity, hours: r.hours, requiresApproval: !!r.requires_approval, active: r.active !== false });
const amenityToDb = (a) => {
  const o = {};
  if (a.building !== undefined) o.building = a.building;
  if (a.name !== undefined) o.name = a.name;
  if (a.description !== undefined) o.description = a.description;
  if (a.capacity !== undefined) o.capacity = a.capacity === '' ? null : a.capacity;
  if (a.hours !== undefined) o.hours = a.hours;
  if (a.requiresApproval !== undefined) o.requires_approval = !!a.requiresApproval;
  if (a.active !== undefined) o.active = !!a.active;
  return o;
};
const bookingFromDb = (r) => ({ id: r.id, amenityId: r.amenity_id, residentId: r.resident_id, bookedBy: r.booked_by, building: r.building, unit: r.unit, date: r.date, startTime: r.start_time, endTime: r.end_time, status: r.status, notes: r.notes });
const bookingToDb = (b) => {
  const o = {};
  if (b.amenityId !== undefined) o.amenity_id = b.amenityId;
  if (b.residentId !== undefined) o.resident_id = b.residentId;
  if (b.bookedBy !== undefined) o.booked_by = b.bookedBy;
  if (b.building !== undefined) o.building = b.building;
  if (b.unit !== undefined) o.unit = b.unit;
  if (b.date !== undefined) o.date = b.date;
  if (b.startTime !== undefined) o.start_time = b.startTime || null;
  if (b.endTime !== undefined) o.end_time = b.endTime || null;
  if (b.status !== undefined) o.status = b.status;
  if (b.notes !== undefined) o.notes = b.notes;
  return o;
};
export async function listAmenities(orgId) {
  const { data, error } = await supabase.from('amenities').select('*').eq('org_id', orgId).order('name', { ascending: true });
  if (error) return [];
  return (data || []).map(amenityFromDb);
}
export async function addAmenity(orgId, a) {
  const { data, error } = await supabase.from('amenities').insert({ org_id: orgId, ...amenityToDb(a) }).select('*').single();
  if (error) throw error;
  return amenityFromDb(data);
}
export async function updateAmenity(id, patch) {
  const { error } = await supabase.from('amenities').update(amenityToDb(patch)).eq('id', id);
  if (error) throw error;
}
export async function deleteAmenity(id) {
  const { error } = await supabase.from('amenities').delete().eq('id', id);
  if (error) throw error;
}
export async function listBookings(orgId) {
  const { data, error } = await supabase.from('amenity_bookings').select('*').eq('org_id', orgId).order('date', { ascending: true });
  if (error) return [];
  return (data || []).map(bookingFromDb);
}
export async function addBooking(orgId, b) {
  const { data, error } = await supabase.from('amenity_bookings').insert({ org_id: orgId, ...bookingToDb(b) }).select('*').single();
  if (error) throw error;
  return bookingFromDb(data);
}
export async function setBookingStatus(id, status) {
  const { error } = await supabase.from('amenity_bookings').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function listVendorProducts(orgId) {
  const { data, error } = await supabase.from('vendor_products').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(productFromDb);
}
export async function addVendorProduct(orgId, p) {
  const { data, error } = await supabase.from('vendor_products').insert({ org_id: orgId, ...productToDb(p) }).select('*').single();
  if (error) throw error;
  return productFromDb(data);
}
export async function updateVendorProduct(id, patch) {
  const { error } = await supabase.from('vendor_products').update(productToDb(patch)).eq('id', id);
  if (error) throw error;
}
export async function deleteVendorProduct(id) {
  const { error } = await supabase.from('vendor_products').delete().eq('id', id);
  if (error) throw error;
}
export function subscribeVendors(orgId, cb) {
  const ch = supabase.channel('vendors-' + orgId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors', filter: `org_id=eq.${orgId}` }, cb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_products', filter: `org_id=eq.${orgId}` }, cb)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// bulk import a parsed lease workbook → properties + units + leases
export async function importLeaseBuildings(orgId, buildings) {
  const { data: props } = await supabase.from('properties').select('id,name').eq('org_id', orgId);
  const byName = new Map((props || []).map((p) => [p.name.toLowerCase(), p.id]));
  let nb = 0, nu = 0;
  for (const b of buildings) {
    let pid = byName.get(b.name.toLowerCase());
    if (!pid) {
      const { data: np } = await supabase.from('properties')
        .insert({ org_id: orgId, name: b.name, city: b.city || null, units: b.units.length }).select('id').single();
      pid = np?.id; if (pid) byName.set(b.name.toLowerCase(), pid);
    }
    let sort = 0;
    for (const u of b.units) {
      const { data: nuRow } = await supabase.from('units').insert({
        org_id: orgId, property_id: pid, building: b.name, name: u.number, beds: u.beds,
        unit_type: u.type || 'residential', sqft: u.sqft || null, furnished: !!u.furnished,
        status: u.status || 'vacant', sort: sort++,
      }).select('id').single();
      nu++;
      if (nuRow?.id) {
        await supabase.from('leases').insert({
          org_id: orgId, unit_id: nuRow.id,
          tenant_name: u.tenant ? await encStr(u.tenant) : null, tenant_phone: u.phone ? await encStr(u.phone) : null,
          rent: u.rent, fees: u.fees || {}, total: u.total, deposit: u.deposit,
          lease_start: u.leaseStart || u.lease_start || null, lease_end: u.leaseEnd || u.lease_end || null,
          renewal_status: u.renewalStatus || null, notes: u.note || null, active: true,
        });
      }
    }
    nb++;
  }
  return { buildings: nb, units: nu };
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

// ---- cloud labor persistence: the imported spine follows the account ----
// staff-only (carries rates). Stored as a single per-org document.
export async function getLaborState(orgId) {
  const sel = (cols) => supabase.from('labor_state').select(cols).eq('org_id', orgId).maybeSingle();
  let { data, error } = await sel('imported, props, range, salaries, plconfig, inactive_ops');
  // tolerate a DB that hasn't added the inactive_ops / plconfig / salaries columns yet (no regression)
  if (error && /inactive_ops/i.test(error.message || '')) ({ data, error } = await sel('imported, props, range, salaries, plconfig'));
  if (error && /plconfig/i.test(error.message || '')) ({ data, error } = await sel('imported, props, range, salaries'));
  if (error && /salaries/i.test(error.message || '')) ({ data, error } = await sel('imported, props, range'));
  if (error) throw error;
  if (!data) return null;
  // labor rows carry pay rates → imported/props/salaries/plconfig blobs encrypted at rest.
  // inactive_ops is just a set of operator ids (no pay) → plain jsonb.
  return {
    imported: await decBlob(data.imported), props: await decBlob(data.props), range: data.range,
    salaries: data.salaries ? await decBlob(data.salaries) : null,
    plconfig: data.plconfig ? await decBlob(data.plconfig) : null,
    inactiveOps: data.inactive_ops && typeof data.inactive_ops === 'object' ? data.inactive_ops : null,
  };
}

export async function saveLaborState(orgId, s) {
  const base = {
    org_id: orgId, imported: await encBlob(s.imported), props: await encBlob(s.props),
    range: s.range, updated_at: new Date().toISOString(),
  };
  if (s.salaries !== undefined) base.salaries = await encBlob(s.salaries);
  if (s.plconfig !== undefined) base.plconfig = await encBlob(s.plconfig);
  const full = s.inactiveOps !== undefined ? { ...base, inactive_ops: s.inactiveOps } : base;
  const noInactive = { ...full }; delete noInactive.inactive_ops;
  const noPl = { ...noInactive }; delete noPl.plconfig;
  const noSal = { ...noPl }; delete noSal.salaries;
  let { error } = await supabase.from('labor_state').upsert(full, { onConflict: 'org_id' });
  // step down through un-migrated columns: inactive_ops, then plconfig, then salaries
  if (error && /inactive_ops/i.test(error.message || '')) ({ error } = await supabase.from('labor_state').upsert(noInactive, { onConflict: 'org_id' }));
  if (error && /plconfig/i.test(error.message || '')) ({ error } = await supabase.from('labor_state').upsert(noPl, { onConflict: 'org_id' }));
  if (error && /salaries/i.test(error.message || '')) ({ error } = await supabase.from('labor_state').upsert(noSal, { onConflict: 'org_id' }));
  if (error) throw error;
}

// go-live reset: clear an org's TEST/operational rows so a beta workspace
// starts clean. Each table is deleted independently (a missing/edge table never
// aborts the rest). RLS keeps it scoped to this org, and office-only. Portfolio
// (rent roll + vendors) is preserved unless includePortfolio is set.
export async function wipeOrgData(orgId, { includePortfolio = false } = {}) {
  const del = async (table) => {
    try { const { error } = await supabase.from(table).delete().eq('org_id', orgId); return { table, ok: !error }; }
    catch { return { table, ok: false }; }
  };
  // operational first; portfolio (leases before units for the FK) only on request
  const tables = ['timers', 'work_orders', 'purchases', 'documents', 'live_timers', 'messages', 'chat_channels', 'property_cards', 'availability', 'labor_state'];
  if (includePortfolio) tables.push('leases', 'units', 'vendor_products', 'vendors');
  const results = [];
  for (const t of tables) results.push(await del(t));
  return results;
}

// native buildings discovered from an Excel import (non-integrated shops)
// the org's buildings for the pickers — readable by every member (crew included)
// so the Field timer + timesheet property dropdowns populate regardless of role
export async function listProperties(orgId) {
  const { data, error } = await supabase.from('properties')
    .select('id,name,city,units,lat,lng,geofence_m').eq('org_id', orgId).order('name');
  if (error) throw error;
  return (data || []).map((p) => ({
    id: p.id, name: p.name, city: p.city || '', units: p.units || 0,
    lat: p.lat ?? null, lng: p.lng ?? null, geofence: p.geofence_m ?? null,
  }));
}

// the org's operators (people with a seat) — assignable for work even before
// they have any pay-log history. Name is the plaintext display_name.
export async function listOperators(orgId) {
  const sel = (cols) => supabase.from('operators').select(cols).eq('org_id', orgId);
  let { data, error } = await sel('id, user_id, display_name, role, status, hourly_rate');
  if (error && /hourly_rate|column/i.test(error.message || '')) ({ data, error } = await sel('id, user_id, display_name, role, status'));
  if (error) throw error;
  return (data || [])
    .filter((o) => (o.status || 'active') === 'active')
    .map((o) => ({ id: o.id, userId: o.user_id || null, name: o.display_name || 'Operator', role: o.role || 'tech', status: o.status || 'active', rate: Number(o.hourly_rate) || 0 }));
}

// set an operator's hourly rate (staff-only via op_staff RLS). Plaintext numeric.
export async function setOperatorRate(operatorId, rate) {
  const { error } = await supabase.from('operators').update({ hourly_rate: rate == null ? null : Number(rate) }).eq('id', operatorId);
  if (error) throw error;
}

export async function insertProperties(orgId, props) {
  // Skip names that already exist for the org (case-insensitive). A re-import
  // whose matcher missed an existing building must not stack a duplicate row —
  // this is the DB-level backstop against the property list ballooning.
  const { data: existing } = await supabase.from('properties').select('name').eq('org_id', orgId);
  const have = new Set((existing || []).map((r) => (r.name || '').trim().toLowerCase()));
  const rows = props
    .filter((p) => p.name && !have.has(p.name.trim().toLowerCase()))
    .map((p) => ({ org_id: orgId, name: p.name, city: p.city || null, units: p.units || 0, external_src: 'native' }));
  if (!rows.length) return;
  const { error } = await supabase.from('properties').insert(rows);
  if (error) throw error;
}

// set a building's geofence pin (verified clock-in). Matches by name; creates
// the property row if the org doesn't have one yet. Staff-only via RLS.
export async function setPropertyLocation(orgId, name, { lat, lng, geofence = 150 } = {}) {
  const patch = { lat, lng, geofence_m: geofence };
  const { data: found } = await supabase.from('properties')
    .select('id').eq('org_id', orgId).ilike('name', name).limit(1).maybeSingle();
  if (found?.id) {
    const { error } = await supabase.from('properties').update(patch).eq('id', found.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('properties').insert({ org_id: orgId, name, units: 0, external_src: 'native', ...patch });
    if (error) throw error;
  }
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

// ---- live presence: who's on the clock right now ----
const ltFromDb = (r) => ({
  userId: r.user_id, operatorLabel: r.operator_label, workOrderId: r.work_order_id,
  task: r.task, propLabel: r.prop_label, unit: r.unit, startedAt: r.started_at, onBreak: r.on_break,
});

export async function listLiveTimers(orgId) {
  const { data, error } = await supabase.from('live_timers').select('*').eq('org_id', orgId);
  if (error) throw error;
  return data.map(ltFromDb);
}

export async function upsertLiveTimer(orgId, t) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('live_timers').upsert({
    org_id: orgId, user_id: user.id, operator_label: t.operatorLabel,
    work_order_id: t.workOrderId || null, task: t.task || null,
    prop_label: t.propLabel || null, unit: t.unit || null,
    started_at: t.startedAt, on_break: !!t.onBreak, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,user_id' });
  if (error) throw error;
}

export async function deleteLiveTimer(orgId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('live_timers').delete().eq('org_id', orgId).eq('user_id', user.id);
}

// ---- Web Push subscriptions: one row per device endpoint, owned by the user ----
export async function savePushSubscription(orgId, { endpoint, p256dh, auth }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id, org_id: orgId || null, endpoint, p256dh, auth,
    user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

// purchases: a receipt submitted from the field pings the office live (needs
// migration 0056; without it the channel simply never fires)
export function subscribePurchases(orgId, cb) {
  const ch = supabase.channel('purchases-live-' + orgId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `org_id=eq.${orgId}` }, (payload) => cb(payload))
    .subscribe();
  return () => supabase.removeChannel(ch);
}
export function subscribeLiveTimers(orgId, cb) {
  const ch = supabase.channel('live-timers-' + orgId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_timers', filter: `org_id=eq.${orgId}` }, () => cb())
    .subscribe();
  return () => supabase.removeChannel(ch);
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
