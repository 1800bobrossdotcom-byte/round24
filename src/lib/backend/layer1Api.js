// src/lib/backend/layer1Api.js
// Layer 1 — Developer console API. Cross-tenant, gated server-side by
// is_platform_admin() (see supabase/migrations/0049_layer1_developer.sql).
// Lives next to supabase.js/crypto.js so both devs know where the data layer
// lives — but is its own file, on purpose, so Layer 1 work never touches the
// same lines of supabase.js that Layer 2/3 work is also editing.
//
// isPlatformAdmin / adminCreateWorkspace / decideWorkspaceRequest and the
// request-queue helpers already exist in supabase.js (pre-dating this file)
// and are re-exported here so DeveloperShell only has one import to worry
// about. (adminListOrgs is deliberately NOT re-exported — layer1ListOrgs
// below supersedes it.) Don't duplicate their definitions — extend
// supabase.js's originals only if their shape needs to change, and if so,
// do it there, not by shadowing them here.
//
// task02c: signIn/signOut added to this re-export list so DeveloperShell's
// new no-session sign-in form has one import to worry about too.

import { supabase } from './supabase.js';
export {
  isPlatformAdmin,
  getSession,
  signIn,
  signOut,
  adminCreateWorkspace,
  listWorkspaceRequests,
  decideWorkspaceRequest,
  listDeletionRequests,
  resolveDeletionRequest,
} from './supabase.js';

const call = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};

// ---- Overview ----
export const layer1Overview = () => call('admin_platform_overview');

// ---- Workspaces (richer replacement for the old adminListOrgs shape) ----
export const layer1ListOrgs = () => call('admin_list_orgs');
export const layer1OrgDetail = (orgId) => call('admin_org_detail', { p_org: orgId });
export const layer1SetMemberRole = (orgId, userId, role) =>
  call('admin_set_member_role', { p_org: orgId, p_user: userId, p_role: role });
export const layer1RemoveMember = (orgId, userId) =>
  call('admin_remove_member', { p_org: orgId, p_user: userId });
export const layer1CreateInvite = (orgId, role, email, label) =>
  call('admin_create_invite', { p_org: orgId, p_role: role, p_email: email ?? null, p_label: label ?? null });

// ---- Support sessions ("enter a workspace") ----
export const layer1JoinWorkspace = (orgId, hours = 4) =>
  call('admin_join_workspace', { p_org: orgId, p_hours: hours });
export const layer1LeaveWorkspace = (orgId) =>
  call('admin_leave_workspace', { p_org: orgId });
// clears expired support seats; DeveloperShell fires this on load so a dead
// session can't linger as a half-live membership until the next join.
export const layer1SweepSupport = () => call('platform_sweep_support');

// ---- Users ----
export const layer1ListUsers = () => call('admin_list_users');

// ---- Developers (the platform_admins allowlist itself) ----
export const layer1ListDevelopers = () => call('admin_list_platform_admins');
export const layer1AddDeveloper = (email) => call('admin_add_platform_admin', { p_email: email });
export const layer1RemoveDeveloper = (email) => call('admin_remove_platform_admin', { p_email: email });

// ---- Global UI/UX control ----
// getPlatformFlags is a plain select (safe for anon/pre-auth), so it's a
// normal query, not an RPC — matches how platform_flags_read policy is set up.
export const layer1GetFlags = async () => {
  const { data, error } = await supabase.from('platform_flags').select('*');
  if (error) throw error;
  return data;
};
export const layer1SetFlag = (key, value) => call('admin_set_platform_flag', { p_key: key, p_value: value });

// ---- Audit ----
export const layer1ListAudit = (limit = 200) => call('admin_list_audit', { p_limit: limit });
