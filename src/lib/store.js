import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import seed from '../data/seed.json';
import { useAuth } from '../components/AuthGate.jsx';
import { DEMO_PROPERTIES, buildDemoTimers, DEMO_WORK_ORDERS, DEMO_PURCHASES } from './demoData.js';
import { DEMO_LEASING, DEMO_PORTFOLIO, BUILDING_GEO, DEMO_PORTFOLIO_LABOR, DEMO_PL_CONFIG } from '../data/leaseDemo.js';
import { DEMO_VENDORS, DEMO_VENDOR_PRODUCTS } from '../data/vendorDemo.js';
import {
  isConfigured, listWorkOrders, insertWorkOrder, updateWorkOrderStatus,
  updateWorkOrderPriority, updateWorkOrderAssignee, updateWorkOrderBilling, subscribeWorkOrders,
  listPurchases, insertPurchase, setPurchaseStatus as dbSetPurchaseStatus, uploadReceipt,
  listDocuments, uploadDocument,
  listMessages, insertMessage, subscribeMessages, uploadVoiceNote, summarizeThread,
  uploadAttachment, updateWorkOrderPhotos, updateWorkOrderFiles,
  listLeasing, updateLeaseRow, updateUnitRow, importLeaseBuildings, addUnitWithLease, deleteUnit, clearLeasing as clearLeasingDb,
  listVendors, addVendor, updateVendor, deleteVendor,
  listVendorProducts, addVendorProduct, updateVendorProduct, deleteVendorProduct, subscribeVendors,
  upsertChatMember, listChatMembers, listChatChannels, insertChatChannel,
  listPropertyCards, insertPropertyCard, deletePropertyCard,
  listLiveTimers, upsertLiveTimer, deleteLiveTimer, subscribeLiveTimers,
  getLaborState, saveLaborState,
  listAvailability, setAvailability, subscribeAvailability, logAudit,
  fetchMyOperatorId, insertTimer, updateTimer, insertProperties, getUserSettings,
  setPropertyLocation, listTimers, deleteTimer, wipeOrgData, listProperties, listOperators, setOperatorRate as setOperatorRateDb,
} from './backend/supabase.js';

const IMP_KEY = 'caliper_imported_v1';
const WO_KEY = 'caliper_workorders_v1';
const PUR_KEY = 'caliper_purchases_v1';
const PROP_KEY = 'caliper_props_v1';       // buildings discovered from imports (non-integrated shops)
const TQ_KEY = 'caliper_timerqueue_v1';   // offline queue for unsynced timer entries
const SEEN_KEY = 'caliper_seen_v1';        // per-tab "last viewed" stamps → nav badges
const MSG_KEY = 'caliper_messages_v1';     // team comms fallback when unmigrated
const CHAN_KEY = 'caliper_channels_v1';    // local DM/group definitions (demo mode)

function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
// local YYYY-MM-DD `days` out from today. The office labor window's default upper
// bound rides this so freshly logged work (dated today or a hair into tomorrow by
// timezone) always lands inside the range the dashboards filter to.
function isoAhead(days = 0) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DEFAULT_RANGE = () => ({ from: '2026-05-11', to: isoAhead(14) });

// locate an unsynced timer payload in the offline queue by CONTENT. Matches on
// building + hours + category + date + note so two same-shaped punches on
// different days (or a same-day edit) don't splice the wrong one. Returns -1 if
// no confident match. Used to retract a stale payload before re-submitting an
// edit, and to drop a queued entry the user deleted before it ever synced.
function queueMatchIdx(q, entry) {
  const label = entry.prop ?? entry.propLabel ?? null;
  const hrs = entry.hrs ?? entry.durationHrs ?? 0;
  const date = entry.date ?? null;
  const note = entry.note ?? entry.issue ?? null;
  const cat = entry.category || 'general';
  return q.findIndex((t) => (t.propLabel ?? null) === label
    && Math.abs((t.durationHrs || 0) - hrs) < 0.001
    && (t.category || 'general') === cat
    && (t.date ?? null) === date
    && (t.note ?? t.issue ?? null) === note);
}
// Cache write that can't crash an effect. Demo/local mode stashes inline data URLs
// (photos, voice notes) that can blow past the ~5MB quota — a QuotaExceededError here
// must degrade to "not cached", never throw out of the render/effect.
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

// One-time purge of pre-fix imported caches. Older builds appended every
// upload, so browsers carry compounded test data that a code deploy can't
// reach. Bump SCHEMA_VERSION to force every client to start clean on load.
const SCHEMA_KEY = 'caliper_import_schema';
const SCHEMA_VERSION = '4';   // bump: purge shared org-data caches that bled across tenants on one browser
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(SCHEMA_KEY) !== SCHEMA_VERSION) {
    // clear every non-org-scoped cache of org data — on a shared browser these leaked
    // one tenant's labor/buildings/work-orders/messages into the next account. All of
    // these re-fetch from the cloud for a configured org, so nothing real is lost.
    [IMP_KEY, PROP_KEY, WO_KEY, PUR_KEY, MSG_KEY, 'caliper_cards_v1', 'caliper_salaries_v1'].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION);
  }
} catch { /* private mode / no storage — nothing to purge */ }

const blobToDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

const slugTech = (name) =>
  't_imp_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const normName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function useStore() {
  const { orgId, role, session, orgName } = useAuth();
  const myId = session?.user?.id || null;
  // prefer the display name the person set in Settings; fall back to the email
  // handle. This is what labels their chat messages, live presence, availability,
  // and audit entries — so the name they chose shows everywhere, not the raw email.
  const [profileName, setProfileName] = useState('');
  useEffect(() => {
    if (!isConfigured() || !session) { setProfileName(''); return; }
    let on = true;
    getUserSettings().then((d) => { if (on) setProfileName((d?.displayName || '').trim()); }).catch(() => {});
    return () => { on = false; };
  }, [myId]);
  const myName = profileName || session?.user?.email?.split('@')[0] || (role === 'tech' ? 'Crew' : 'Office');
  const myCommsRole = role === 'admin' || role === 'manager' ? 'office' : 'crew';

  // ---- imported pay-log data (merged into the same spine the charts read) ----
  // A configured org is cloud-authoritative and re-hydrates its own labor state, so it
  // must NOT seed from — or write to — this shared cache: on one browser it would bleed
  // the previous tenant's labor into a new account. Only demo uses the localStorage copy.
  const [imported, setImported] = useState(() => (isConfigured() ? { timers: [], techs: [] } : loadLS(IMP_KEY, { timers: [], techs: [] })));
  useEffect(() => { if (!isConfigured()) saveLS(IMP_KEY, imported); }, [imported]);

  // ---- nav notification badges: count items newer than the last time the
  // user opened that tab. Seed stamps to "now" on first run so pre-existing
  // items don't all badge. markSeen(tab) clears a tab's badge on open.
  const [seen, setSeen] = useState(() => loadLS(SEEN_KEY, null) || { wo: Date.now(), pur: Date.now(), docs: Date.now(), chat: Date.now() });
  useEffect(() => { saveLS(SEEN_KEY, seen); }, [seen]);
  const markSeen = useCallback((tab) => {
    if (!['wo', 'pur', 'docs', 'chat'].includes(tab)) return;
    setSeen((s) => ({ ...s, [tab]: Date.now() }));
  }, []);

  // seed.json is SAMPLE data for the unconfigured demo experience only. A
  // real, logged-in org must never see it mixed into its charts — it sees
  // only its own imported/real data.
  const demoMode = !isConfigured();
  const techsRaw = useMemo(() => [...(demoMode ? seed.techs : []), ...imported.techs], [imported.techs, demoMode]);
  // spineTimers = the imported/historical labor spine. In demo mode we also fold in
  // a little verified portfolio labor so the owner's P&L and the "% verified on-site"
  // stat populate out of the box. This is history only — live-logged work lands in
  // the timers table (tsTable) and is merged into `allTimers` below.
  const spineTimers = useMemo(
    () => [...(demoMode ? [...seed.timers, ...DEMO_PORTFOLIO_LABOR] : []), ...imported.timers],
    [imported.timers, demoMode],
  );
  // tsTable = the editable, cloud-backed timers-table rows (CRUD target, loaded by
  // the effect further down). Declared up here so the staff-facing `allTimers`
  // merge below can fold live-logged work into the office dashboards.
  const [tsTable, setTsTable] = useState([]);
  const tsTableRef = useRef(tsTable);
  useEffect(() => { tsTableRef.current = tsTable; }, [tsTable]);

  const [range, setRange] = useState(DEFAULT_RANGE);

  // ---- buildings discovered from imports (non-integrated shops start empty) ----
  const [impProps, setImpProps] = useState(() => (isConfigured() ? [] : loadLS(PROP_KEY, [])));
  useEffect(() => { if (!isConfigured()) saveLS(PROP_KEY, impProps); }, [impProps]);
  const impPropsRef = useRef(impProps);
  useEffect(() => { impPropsRef.current = impProps; }, [impProps]);

  // ---- salaried operators: a fixed salary, dispersed across doors by hours ----
  // Rides the per-org labor-state document (encrypted — it carries pay). For a
  // real org the cloud is authoritative and we never touch localStorage, so
  // salaries can't bleed between tenants on a shared browser; demo uses local.
  const [salaries, setSalaries] = useState(() => (demoMode ? loadLS('caliper_salaries_v1', {}) : {}));
  useEffect(() => { if (demoMode) saveLS('caliper_salaries_v1', salaries); }, [salaries, demoMode]);
  const setSalary = useCallback((techId, val) => {
    setSalaries((s) => {
      const next = { ...s };
      if (!val || !(val.amount > 0)) delete next[techId];
      else next[techId] = { amount: Number(val.amount), period: val.period || 'year' };
      return next;
    });
  }, []);

  // ---- inactive operators: left the company, keep their history ----
  // A { techId: true } set that rides labor_state. An inactive operator's past
  // timers still count everywhere historical; they're just dropped from the
  // ACTIVE roster (no new work-order assignment, DMs, or availability). Reversible.
  const [inactiveOps, setInactiveOps] = useState(() => (demoMode ? loadLS('caliper_inactive_ops_v1', {}) : {}));
  useEffect(() => { if (demoMode) saveLS('caliper_inactive_ops_v1', inactiveOps); }, [inactiveOps, demoMode]);
  const setOperatorActive = useCallback((techId, active) => {
    if (!techId) return;
    setInactiveOps((s) => {
      const next = { ...s };
      if (active) delete next[techId]; else next[techId] = true;
      return next;
    });
  }, []);
  // the org's operators (people with a seat) — assignable for work even before
  // they log any pay-log hours. Cleared spine ≠ empty roster.
  const [operators, setOperators] = useState([]);
  useEffect(() => {
    if (!isConfigured() || !orgId) { setOperators([]); return undefined; }
    let alive = true;
    listOperators(orgId).then((r) => { if (alive) setOperators(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId]);
  // set an operator's hourly rate (office). Optimistic; persists to the operator row.
  const setOperatorRate = useCallback(async (operatorId, rate) => {
    const r = Number(rate) || 0;
    setOperators((l) => l.map((o) => (o.id === operatorId ? { ...o, rate: r } : o)));
    if (isConfigured()) { try { await setOperatorRateDb(operatorId, r); } catch { /* keep optimistic */ } }
  }, []);

  // canonical operator list, tagged with employment status (inactive = departed).
  // techById stays complete so historical names always resolve; assignment
  // rosters filter on `.active`. Pay-log-discovered techs are merged with the
  // org's operator seats (deduped by name) so real people are always assignable.
  const techs = useMemo(() => {
    const base = techsRaw.map((t) => ({ ...t, active: !inactiveOps[t.id] }));
    const haveName = new Set(base.map((t) => (t.name || '').trim().toLowerCase()));
    const seats = operators
      .filter((o) => o.name && !haveName.has(o.name.trim().toLowerCase()))
      .map((o) => ({ id: o.id, name: o.name, rate: o.rate || 0, role: o.role || 'tech', active: !inactiveOps[o.id], operator: true }));
    return [...base, ...seats];
  }, [techsRaw, inactiveOps, operators]);
  const activeTechs = useMemo(() => techs.filter((t) => t.active), [techs]);

  // ---- P&L statement config: fixed per-building inputs (debt, utilities, tax) ----
  // Kept in a single localStorage doc keyed by org, so plConfig is derived (never
  // a lagging copy) and can't bleed between tenants on a shared browser.
  const [plAll, setPlAll] = useState(() => loadLS('caliper_plconfig_v2', {}));
  useEffect(() => { saveLS('caliper_plconfig_v2', plAll); }, [plAll]);
  const plKey = demoMode ? '__demo__' : (orgId || '__none__');
  const plConfig = useMemo(
    () => (demoMode ? { ...DEMO_PL_CONFIG, ...(plAll.__demo__ || {}) } : (plAll[plKey] || {})),
    [plAll, plKey, demoMode],
  );
  const setPlLine = useCallback((building, patch) => {
    setPlAll((a) => { const cur = a[plKey] || {}; return { ...a, [plKey]: { ...cur, [building]: { ...(cur[building] || {}), ...patch } } }; });
  }, [plKey]);

  // ---- cloud labor persistence: the spine follows the account (staff only) ----
  // localStorage is the fast local cache; when connected, this org record is the
  // source of truth so dashboards/team/properties are the same on every device.
  const [laborBackend, setLaborBackend] = useState('local');
  const hydratedRef = useRef(false);
  const loadedOrgRef = useRef(null); // which org the current spine was hydrated for
  const isStaffMember = role === 'admin' || role === 'manager';
  useEffect(() => {
    if (!isConfigured() || !orgId || !isStaffMember) { hydratedRef.current = true; return undefined; }
    // switching orgs: shut the write-through gate FIRST so a debounced flush can't
    // push the previous org's spine into this one before its real data loads. The
    // cloud record is authoritative, so an org with no saved state clears the spine
    // (rather than leaving the prior tenant's timers/props/range/salaries showing).
    hydratedRef.current = false;
    setLaborBackend('local');
    let alive = true;
    getLaborState(orgId).then((s) => {
      if (!alive) return;
      if (s?.imported && (s.imported.timers?.length || s.imported.techs?.length)) setImported(s.imported);
      else setImported({ timers: [], techs: [] });
      if (s && Array.isArray(s.props)) { impPropsRef.current = s.props; setImpProps(s.props); }
      else { impPropsRef.current = []; setImpProps([]); }
      // honor a saved window, but never let a stale saved upper bound hide work
      // logged since — always extend `to` to at least today's default.
      if (s?.range?.from && s?.range?.to) { const d = DEFAULT_RANGE(); setRange({ from: s.range.from, to: s.range.to > d.to ? s.range.to : d.to }); }
      else setRange(DEFAULT_RANGE());
      setSalaries(s?.salaries && typeof s.salaries === 'object' ? s.salaries : {});
      setInactiveOps(s?.inactiveOps && typeof s.inactiveOps === 'object' ? s.inactiveOps : {});
      // per-building P&L config rides the same doc — cloud is authoritative when present
      if (s?.plconfig && typeof s.plconfig === 'object') setPlAll((a) => ({ ...a, [orgId]: s.plconfig }));
      loadedOrgRef.current = orgId;
      setLaborBackend('db');
      hydratedRef.current = true;
    }).catch(() => { if (alive) { setLaborBackend('local'); hydratedRef.current = true; } });
    return () => { alive = false; };
  }, [orgId, isStaffMember]);
  // write-through: after hydration, sync any spine change up (debounced). The
  // loadedOrg guard is a belt-and-suspenders against writing before the new org resolves.
  useEffect(() => {
    if (laborBackend !== 'db' || !hydratedRef.current || !orgId || !isStaffMember || loadedOrgRef.current !== orgId) return undefined;
    const t = setTimeout(() => { saveLaborState(orgId, { imported, props: impProps, range, salaries, plconfig: plAll[orgId] || {}, inactiveOps }).catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [imported, impProps, range, salaries, plAll, inactiveOps, laborBackend, orgId, isStaffMember]);

  // per-building geofence pins for verified clock-in. A pin can come from three
  // places, in priority order: a location the office just set (override), the
  // property's own stored lat/lng (cloud), or the sample BUILDING_GEO (demo).
  const [propLoc, setPropLoc] = useState({}); // id → { lat, lng, geofence }
  // the org's buildings from the properties table — loaded for EVERY role. Kept
  // SEPARATE from `properties` (below): the table can hold messy name-variants of
  // the same building (e.g. "301 Central" vs "301 Central Ave"), so merging it into
  // the authoritative list duplicates buildings in the office Buildings/P&L views.
  // It's only a fallback for the crew picker, who have no impProps to pick from.
  const [cloudProps, setCloudProps] = useState([]);
  useEffect(() => {
    if (demoMode || !isConfigured() || !orgId) { setCloudProps([]); return undefined; }
    let alive = true;
    listProperties(orgId).then((r) => { if (alive) setCloudProps(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId, demoMode]);
  const decorateGeo = useCallback((p) => {
    const o = propLoc[p.id];
    const geo = o || (p.lat != null ? { lat: p.lat, lng: p.lng, geofence: p.geofence_m ?? p.geofence ?? 150 } : BUILDING_GEO[p.name]);
    return geo ? { ...p, lat: geo.lat, lng: geo.lng, geofence: geo.geofence ?? 150 } : p;
  }, [propLoc]);
  // authoritative building list — rent-roll/labor spine only. Drives the office
  // Buildings + per-door P&L views, so it must stay clean (no properties-table dupes).
  const properties = useMemo(
    () => [...(demoMode ? seed.properties : []), ...impProps].map(decorateGeo),
    [impProps, demoMode, decorateGeo],
  );
  // list the Field timer + timesheet dropdowns pick from: the authoritative list
  // when we have one, else the properties table so crew (no impProps) still get
  // buildings to choose. Never feeds the office building/P&L views.
  const pickProperties = useMemo(
    () => (properties.length ? properties : cloudProps.map(decorateGeo)),
    [properties, cloudProps, decorateGeo],
  );
  // index the picker list (superset for crew) so id lookups resolve for everyone;
  // identical to `properties` for office where pickProperties === properties
  const propById = useMemo(() => Object.fromEntries(pickProperties.map((p) => [p.id, p])), [pickProperties]);

  // set a building's geofence pin (office/owner action). Updates locally at once
  // and, for a connected org, persists to the property row so the crew's next
  // punch is judged against it.
  const setBuildingLocation = useCallback(async (propId, loc) => {
    setPropLoc((m) => ({ ...m, [propId]: { lat: loc.lat, lng: loc.lng, geofence: loc.geofence ?? 150 } }));
    const p = properties.find((x) => x.id === propId);
    if (isConfigured() && orgId && !demoMode && p?.name) {
      try { await setPropertyLocation(orgId, p.name, loc); audit('set_location', p.name); } catch { /* keep local */ }
    }
  }, [properties, orgId, demoMode]);
  // resolve any tech OR operator by id. Operators are added by their own id even
  // when name-deduped out of the assignment `techs` list, so cloud timer rows
  // (techId = operator id) still find the operator's rate for pay.
  const techById = useMemo(() => {
    const m = Object.fromEntries(techs.map((t) => [t.id, t]));
    for (const o of operators) {
      if (!m[o.id]) m[o.id] = { id: o.id, name: o.name, rate: o.rate || 0, role: o.role || 'tech', active: !inactiveOps[o.id], operator: true };
    }
    return m;
  }, [techs, operators, inactiveOps]);

  // normalized building name → id, so a timer-table row (which carries a propLabel,
  // not a propId) resolves to the office building/P&L views' property.
  const propByName = useMemo(() => {
    const m = {};
    for (const p of pickProperties) { const k = (p.name || '').toLowerCase().trim(); if (k && !(k in m)) m[k] = p.id; }
    return m;
  }, [pickProperties]);
  // map a timer-table row into the spine timer shape the dashboards/P&L reduce
  // over: resolve its building id from the label and its operator rate so labor $
  // and the per-tech/per-door rollups count live-logged work.
  const tsRowToTimer = useCallback((r) => ({
    id: r.id, dbId: r.dbId || null,
    techId: r.techId || r.operatorId || null,
    propId: propByName[(r.propLabel || '').toLowerCase().trim()] || null,
    propLabel: r.propLabel || 'Unassigned', unit: r.unit || '',
    date: r.date, createdAt: r.createdAt || `${r.date}T09:00:00.000Z`,
    category: r.category || 'general', issue: r.note || '', note: r.note || '',
    durationHrs: Number(r.durationHrs) || 0,
    rate: r.rate || techById[r.techId || r.operatorId]?.rate || 0,
    workOrderId: r.workOrderId || null, verified: r.verified ?? null,
    distanceM: r.distanceM ?? null, source: r.source || 'timer',
  }), [propByName, techById]);
  // allTimers = the labor the office dashboards + per-door P&L read. History (the
  // import spine) PLUS live-logged timer-table work, deduped by dbId||id (table
  // rows win). Demo has no cloud table, so it's spine-only. Without this merge the
  // office views would show $0 while the crew's Timesheet showed the same hours.
  const allTimers = useMemo(() => {
    if (demoMode) return spineTimers;
    const live = tsTable.map(tsRowToTimer);
    const seen = new Set(live.map((t) => t.dbId || t.id));
    return [...live, ...spineTimers.filter((t) => !seen.has(t.dbId || t.id))];
  }, [demoMode, tsTable, spineTimers, tsRowToTimer]);

  // resolve building labels → ids, creating a native property for any label
  // not already known. Returns { label: id } synchronously so an import can
  // allocate immediately. Best-effort DB insert when connected.
  const ensureProperties = useCallback((labels) => {
    // dedup against the cloud property table too (not just the local spine) so a
    // re-import reuses existing building rows instead of stacking duplicates.
    // cloudProps first so seed/impProps ids win on a name collision (those are the
    // ids the office views resolve against via pickProperties/propById).
    const current = [...cloudProps, ...(demoMode ? seed.properties : []), ...impPropsRef.current];
    const byName = new Map(current.map((p) => [normName(p.name), p.id]));
    const created = [];
    const map = {};
    for (const label of labels) {
      const key = normName(label);
      if (!key) continue;
      let id = byName.get(key);
      if (!id) {
        id = 'prop_imp_' + (key.replace(/\s+/g, '_') || Math.random().toString(36).slice(2, 8));
        byName.set(key, id);
        created.push({ id, name: label, city: '', units: 0, external_src: 'native', imported: true });
      }
      map[label] = id;
    }
    if (created.length) {
      impPropsRef.current = [...impPropsRef.current, ...created];
      setImpProps(impPropsRef.current);
      if (isConfigured() && orgId) insertProperties(orgId, created).catch(() => {});
    }
    return map;
  }, [orgId, cloudProps]);

  const timers = useMemo(
    () => allTimers.filter((t) => t.date >= range.from && t.date <= range.to),
    [allTimers, range]
  );

  // commit parsed pay-log entries. replace (default) swaps out any previous
  // import so uploads don't compound; add appends to what's there. resolves
  // tech names to ids (reusing seed techs on a name match) and sets the range
  // to the imported span.
  const addImported = useCallback((rows, { replace = true } = {}) => {
    setImported((prev) => {
      const base0 = replace ? { timers: [], techs: [] } : prev;
      const byName = new Map(base0.techs.map((t) => [t.name.toLowerCase(), t]));
      const newTechs = [...base0.techs];
      const base = base0.timers.length;
      const timers = rows.map((r, i) => {
        const nm = r.techName.trim();
        // only reuse seed operators in demo mode; a real org's imported
        // operators must be self-contained (seed techs are hidden for it,
        // so referencing a seed id would dangle and blank the Team view)
        let tech = (demoMode ? seed.techs.find((t) => t.name.toLowerCase() === nm.toLowerCase()) : null)
          || byName.get(nm.toLowerCase());
        if (!tech) {
          tech = { id: slugTech(nm), name: nm, rate: r.rate || 0, role: 'tech', imported: true };
          byName.set(nm.toLowerCase(), tech);
          newTechs.push(tech);
        }
        return {
          id: `imp_${base + i + 1}`, techId: tech.id, propId: r.propId ?? null,
          unit: r.unit || '—', date: r.date, category: r.category || 'imported',
          issue: r.issue || 'imported from pay log', durationHrs: r.durationHrs,
          rate: r.rate || 0, period: r.period || null, imported: true,
        };
      });
      return { techs: newTechs, timers: [...base0.timers, ...timers] };
    });
    const dates = rows.map((r) => r.date).filter(Boolean);
    if (dates.length) {
      const min = dates.reduce((a, d) => (d < a ? d : a));
      const max = dates.reduce((a, d) => (d > a ? d : a));
      // never let an import's last historical date clamp the window shut on
      // work logged since — keep `to` at least at today's default.
      const top = DEFAULT_RANGE().to;
      const to = max > top ? max : top;
      setRange((r) => replace ? { from: min, to }
        : { from: min < r.from ? min : r.from, to: to > r.to ? to : r.to });
    }
  }, [demoMode]);

  // assign unallocated imported entries to a building (+ optional category/unit/
  // note) so they move into the true-cost pipeline. Resolves the building label
  // to a native property, creating it if new.
  const allocateImported = useCallback((ids, { propLabel, category, unit, note } = {}) => {
    const idSet = new Set(ids);
    let propId = null;
    if (propLabel) { const map = ensureProperties([propLabel]); propId = map[propLabel] || null; }
    setImported((prev) => ({
      ...prev,
      timers: prev.timers.map((t) => (idSet.has(t.id) ? {
        ...t,
        propId: propId ?? t.propId,
        unallocated: propId ? false : t.unallocated,
        category: category || t.category,
        unit: unit || t.unit,
        issue: note || t.issue,
      } : t)),
    }));
  }, [ensureProperties]);

  // wipe the imported labor spine: pay-log timers, discovered operators and
  // buildings, and reset the date window. WARNING: for a connected org the
  // labor-state write-through persists this empty state to the CLOUD — this is
  // destructive to every operator's imported history, not just a local reset.
  // The Import view gates it behind a type-to-confirm for that reason.
  const clearImported = useCallback(() => {
    setImported({ timers: [], techs: [] });   // persistence effects write the empty state up
    setImpProps([]); impPropsRef.current = [];
    setRange(DEFAULT_RANGE());
  }, []);

  // ---- work orders: DB-backed when connected, localStorage otherwise ----
  // a configured deployment is cloud-authoritative — don't seed from the shared
  // localStorage cache (it could hold another org's or the demo's rows)
  const [workOrders, setWorkOrders] = useState(() => (isConfigured() ? [] : loadLS(WO_KEY, [])));
  const [woBackend, setWoBackend] = useState('local'); // 'db' | 'local'
  useEffect(() => { if (woBackend !== 'db') saveLS(WO_KEY, workOrders); }, [workOrders, woBackend]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setWorkOrders([]); // drop the previous org's rows on switch; ignore a stale in-flight response
    listWorkOrders(orgId)
      .then((rows) => { if (alive) { setWorkOrders(rows); setWoBackend('db'); } })
      .catch(() => { if (alive) setWoBackend('local'); }); // table not migrated yet → keep local
    return () => { alive = false; };
  }, [orgId]);

  const addWorkOrder = useCallback(async (wo) => {
    const local = { ...wo, id: 'wo_' + Math.random().toString(36).slice(2, 10), status: wo.status || 'open', createdAt: new Date().toISOString() };
    setWorkOrders((l) => [local, ...l]);
    if (isConfigured() && orgId && woBackend === 'db') {
      try {
        const saved = await insertWorkOrder(orgId, local);
        // return the PERSISTED row (real id) so a caller attaching a photo targets
        // the right row — the temp id is already remapped out of state here
        if (saved?.id) { setWorkOrders((l) => l.map((w) => (w.id === local.id ? saved : w))); return saved; }
      } catch { /* keep the local copy; it syncs on next migration */ }
    }
    return local;
  }, [orgId, woBackend]);

  const setWoStatus = useCallback((id, status) => {
    setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, status } : w)));
    if (isConfigured() && woBackend === 'db' && !String(id).startsWith('wo_')) {
      updateWorkOrderStatus(id, status).catch(() => {});
    }
  }, [woBackend]);

  const setWoPriority = useCallback((id, priority) => {
    setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, priority } : w)));
    if (isConfigured() && woBackend === 'db' && !String(id).startsWith('wo_')) {
      updateWorkOrderPriority(id, priority).catch(() => {});
    }
  }, [woBackend]);

  const setWoAssignee = useCallback((id, assigneeLabel) => {
    setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, assigneeLabel } : w)));
    if (isConfigured() && woBackend === 'db' && !String(id).startsWith('wo_')) {
      updateWorkOrderAssignee(id, assigneeLabel).catch(() => {});
    }
  }, [woBackend]);

  // tenant billing on a work order — service fee, repair cost, billed state
  const setWoBilling = useCallback((id, patch) => {
    setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    if (isConfigured() && woBackend === 'db' && !String(id).startsWith('wo_')) {
      updateWorkOrderBilling(id, patch).catch(() => {});
    }
  }, [woBackend]);

  // attach a photo or document to a work order. Images go on `photos` (rendered
  // as thumbnails); other files go on `files` as {path,name} (rendered as cards).
  // Cloud: upload to storage + persist. Demo/local: keep an inline data URL.
  const addWoAttachment = useCallback(async (id, file) => {
    if (!file) return;
    const cloud = isConfigured() && orgId && woBackend === 'db' && !String(id).startsWith('wo_');
    const isImg = (file.type || '').startsWith('image/');
    let ref;
    try { ref = cloud ? await uploadAttachment(orgId, file) : await blobToDataUrl(file); }
    catch { ref = await blobToDataUrl(file); }
    if (isImg) {
      setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, photos: [...(w.photos || []), ref] } : w)));
      if (cloud) {
        const next = [...(woRef.current.find((w) => w.id === id)?.photos || []), ref];
        updateWorkOrderPhotos(id, next).catch(() => {});
      }
    } else {
      const entry = { path: ref, name: file.name || 'file' };
      setWorkOrders((l) => l.map((w) => (w.id === id ? { ...w, files: [...(w.files || []), entry] } : w)));
      if (cloud) {
        const next = [...(woRef.current.find((w) => w.id === id)?.files || []), entry];
        updateWorkOrderFiles(id, next).catch(() => {});
      }
    }
  }, [orgId, woBackend]);

  // ---- live task list: realtime changes → state merge + notification ----
  const [woNotice, setWoNotice] = useState(null); // { msg, ts }
  const woRef = useRef(workOrders);
  useEffect(() => { woRef.current = workOrders; }, [workOrders]);
  useEffect(() => {
    if (!isConfigured() || !orgId || woBackend !== 'db') return;
    const PRIO = { 1: 'URGENT', 2: 'high', 3: 'normal', 4: 'low' };
    const PRIO_KIND = { 1: 'urgent', 2: 'high', 3: 'info', 4: 'info' };
    const notify = (msg, priority = 'info') => {
      setWoNotice({ msg, ts: Date.now(), priority });
      // haptic buzz on supporting devices makes it pronounced on mobile
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(priority === 'urgent' ? [80, 40, 80] : 40); } catch { /* unsupported */ }
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification('Caliper', { body: msg }); } catch { /* mobile needs a SW; the in-app toast covers it */ }
      }
    };
    return subscribeWorkOrders(orgId, (payload) => {
      const { eventType } = payload;
      if (eventType === 'INSERT') {
        const n = payload.new;
        const wo = {
          id: n.id, propLabel: n.property_label, unit: n.unit, task: n.task,
          detail: n.detail, category: n.category, assigneeLabel: n.assignee_label, due: n.due_date,
          status: n.status, priority: n.priority ?? 3, source: n.source, createdAt: n.created_at,
          transcript: n.voice_transcript, photos: n.photos || [], files: n.files || [],
          serviceFee: n.service_fee != null ? Number(n.service_fee) : null,
          repairCost: n.repair_cost != null ? Number(n.repair_cost) : null,
          tenantBilled: n.tenant_billed || 'no',
        };
        // our own just-created WO can arrive over realtime before the insert() call
        // remaps its temp id — upgrade the optimistic row in place instead of adding a
        // duplicate (and don't re-toast our own creation)
        const optimistic = woRef.current.find((w) => String(w.id).startsWith('wo_') && w.task === wo.task
          && Math.abs(new Date(w.createdAt) - new Date(wo.createdAt)) < 15000);
        if (optimistic) {
          setWorkOrders((l) => l.map((w) => (w.id === optimistic.id ? wo : w)));
        } else if (!woRef.current.some((w) => w.id === wo.id)) {
          setWorkOrders((l) => l.some((w) => w.id === wo.id) ? l : [wo, ...l]);
          notify(`New work order: ${wo.task}`, PRIO_KIND[wo.priority] || 'info');
        }
      } else if (eventType === 'UPDATE') {
        const upd = payload.new;
        const prev = woRef.current.find((w) => w.id === upd.id);
        // announce only changes we didn't already apply locally (someone else's edit)
        if (prev && (upd.priority ?? 3) !== (prev.priority ?? 3)) {
          notify(`Priority changed: “${upd.task}” is now ${PRIO[upd.priority ?? 3]}`, PRIO_KIND[upd.priority ?? 3] || 'info');
        } else if (prev && upd.status !== prev.status) {
          notify(`“${upd.task}” is now ${upd.status.replace('_', ' ')}`);
        }
        setWorkOrders((l) => l.map((w) => (w.id === upd.id
          ? { ...w, status: upd.status, priority: upd.priority ?? 3, due: upd.due_date, task: upd.task, assigneeLabel: upd.assignee_label,
              serviceFee: upd.service_fee != null ? Number(upd.service_fee) : w.serviceFee, repairCost: upd.repair_cost != null ? Number(upd.repair_cost) : w.repairCost, tenantBilled: upd.tenant_billed ?? w.tenantBilled }
          : w)));
      } else if (eventType === 'DELETE' && payload.old?.id) {
        setWorkOrders((l) => l.filter((w) => w.id !== payload.old.id));
      }
    });
  }, [orgId, woBackend]);

  // ---- purchases: DB-backed when connected, localStorage otherwise ----
  const [purchases, setPurchases] = useState(() => (isConfigured() ? [] : loadLS(PUR_KEY, [])));
  const [purBackend, setPurBackend] = useState('local');
  useEffect(() => { if (purBackend !== 'db') saveLS(PUR_KEY, purchases); }, [purchases, purBackend]);
  const purchasesRef = useRef(purchases);
  useEffect(() => { purchasesRef.current = purchases; }, [purchases]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setPurchases([]);
    listPurchases(orgId)
      .then((rows) => { if (alive) { setPurchases(rows); setPurBackend('db'); } })
      .catch(() => { if (alive) setPurBackend('local'); });
    return () => { alive = false; };
  }, [orgId]);

  const addPurchase = useCallback(async (p, receiptFile) => {
    let receiptPath = null;
    if (receiptFile && isConfigured() && orgId && purBackend === 'db') {
      try { receiptPath = await uploadReceipt(orgId, receiptFile); } catch { /* keep going without the photo */ }
    }
    const local = { ...p, receiptPath: receiptPath || p.receiptPath || null, id: 'pur_' + Math.random().toString(36).slice(2, 10), status: 'pending', createdAt: new Date().toISOString() };
    setPurchases((l) => [local, ...l]);
    if (isConfigured() && orgId && purBackend === 'db') {
      try {
        const saved = await insertPurchase(orgId, local);
        if (saved?.id) {
          setPurchases((l) => l.map((x) => (x.id === local.id ? saved : x)));
          return { ...saved, synced: true };
        }
      } catch { /* keep local copy */ }
    }
    return local;
  }, [orgId, purBackend]);

  const setPurchaseStatus = useCallback((id, status) => {
    setPurchases((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    if (isConfigured() && purBackend === 'db' && !String(id).startsWith('pur_')) {
      dbSetPurchaseStatus(id, status).catch(() => {});
    }
    if (isConfigured() && orgId && (status === 'approved' || status === 'rejected')) {
      const p = purchasesRef.current.find((x) => x.id === id);
      logAudit(orgId, status === 'approved' ? 'approve_purchase' : 'reject_purchase', p ? `${p.vendor || 'Purchase'} $${p.amount}` : String(id), myName);
    }
  }, [purBackend, orgId, myName]);

  // ---- cloud timers: sync stopped sessions; queue offline, flush later ----
  const [operatorId, setOperatorId] = useState(null);
  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    fetchMyOperatorId().then(setOperatorId).catch(() => setOperatorId(null));
  }, [orgId]);

  // guard against two overlapping flushes (the operatorId effect + the post-insert
  // flush in addTimerEntry can race) both reading the same snapshot and inserting
  // every queued entry twice.
  const flushingRef = useRef(false);
  const flushTimerQueue = useCallback(async (opId) => {
    if (!isConfigured() || !orgId || !opId || flushingRef.current) return;
    const queue = loadLS(TQ_KEY, []);
    if (!queue.length) return;
    flushingRef.current = true;
    try {
      const remaining = [];
      for (const t of queue) {
        try { await insertTimer(orgId, opId, t); }
        catch { remaining.push(t); }
      }
      // entries enqueued while this flush was draining sit past the snapshot — keep them
      const appendedDuring = loadLS(TQ_KEY, []).slice(queue.length);
      localStorage.setItem(TQ_KEY, JSON.stringify([...remaining, ...appendedDuring]));
    } finally { flushingRef.current = false; }
  }, [orgId]);

  useEffect(() => { if (operatorId) flushTimerQueue(operatorId); }, [operatorId, flushTimerQueue]);

  // returns { status: 'synced'|'queued'|'local', id } — id is the cloud row id
  // when synced (so the entry can be edited later), null otherwise.
  const addTimerEntry = useCallback(async (t) => {
    if (!isConfigured() || !orgId) return { status: 'local', id: null };   // demo mode
    if (!operatorId) {
      // no operator record linked to this login (e.g. office staff) — a queue
      // would never flush, so don't pretend it will sync
      return { status: 'local', id: null };
    }
    try { const id = await insertTimer(orgId, operatorId, t); flushTimerQueue(operatorId); return { status: 'synced', id }; }
    catch {
      localStorage.setItem(TQ_KEY, JSON.stringify([...loadLS(TQ_KEY, []), t]));
      return { status: 'queued', id: null };
    }
  }, [orgId, operatorId, flushTimerQueue]);

  // edit a logged timer. If it made it to the cloud (has a dbId) update that
  // row; if it never synced (queued/local), submit it fresh so the corrected
  // entry lands. Returns { status, id } like addTimerEntry.
  const updateTimerEntry = useCallback(async (entry, patch) => {
    if (!isConfigured() || !orgId || !operatorId) return { status: 'local', id: null };
    if (entry.dbId) {
      try { await updateTimer(entry.dbId, patch); return { status: 'synced', id: entry.dbId }; }
      catch { return { status: entry.sync || 'queued', id: entry.dbId }; }
    }
    // never synced — it may be sitting in the offline queue. Retract the STALE
    // payload before re-submitting, or the reconnect flush uploads both the old
    // and the corrected entry and the building double-counts the hours.
    try {
      const q = loadLS(TQ_KEY, []);
      const idx = queueMatchIdx(q, entry);
      if (idx >= 0) { q.splice(idx, 1); localStorage.setItem(TQ_KEY, JSON.stringify(q)); }
    } catch { /* queue unavailable — nothing stale to retract */ }
    return addTimerEntry({
      propLabel: patch.propLabel, unit: patch.unit === '—' ? null : patch.unit,
      date: patch.date, category: patch.category, durationHrs: patch.durationHrs,
      note: patch.note || null, issue: patch.note || null,
    });
  }, [orgId, operatorId, addTimerEntry]);

  // delete a logged timer. If it synced (has a dbId) remove the cloud row. If it
  // never synced it may still be sitting in the offline queue awaiting upload —
  // drop the matching queued payload so a reconnect can't resurrect it. Returns { ok }.
  const deleteTimerEntry = useCallback(async (entry) => {
    if (entry?.dbId && isConfigured()) {
      try { await deleteTimer(entry.dbId); return { ok: true }; }
      catch { return { ok: false }; }   // cloud delete failed — caller keeps the row
    }
    if (!entry?.dbId) {
      try {
        const q = loadLS(TQ_KEY, []);
        const idx = queueMatchIdx(q, entry);
        if (idx >= 0) { q.splice(idx, 1); localStorage.setItem(TQ_KEY, JSON.stringify(q)); }
      } catch { /* queue unavailable — nothing to resurrect anyway */ }
    }
    return { ok: true };
  }, []);

  // ---- timesheet: editable history of logged time (crew self / office review) ----
  // The timers spine, but as rows people can correct — a timer ran long, wrong
  // unit, forgot the note. RLS scopes reads/writes: office all, tech their own.
  // tsTable (declared up top so the office `allTimers` merge can see it) is the
  // editable, cloud-backed timers-table rows. The imported pay-log spine
  // (labor_state.imported) is folded in separately so historicals show without
  // being mistaken for editable table rows.
  const tsRowFromSpine = useCallback((t) => ({
    id: t.id, dbId: t.dbId || null, operatorId: null, techId: t.techId || null,
    date: t.date, createdAt: t.createdAt || `${t.date}T09:00:00.000Z`,
    propLabel: t.propLabel || propById[t.propId]?.name || 'Unassigned',
    unit: t.unit || '', category: t.category || 'general',
    note: t.issue || t.note || '', durationHrs: t.durationHrs || 0,
    workOrderId: t.workOrderId || null, verified: t.verified ?? null,
    distanceM: t.distanceM ?? null, rate: t.rate ?? techById[t.techId]?.rate ?? 0, source: t.source || 'timer',
  }), [propById, techById]);
  useEffect(() => {
    // demo seeds from the sample spine (editable copy); cloud loads the table.
    // Deliberately keyed on [orgId, demoMode] only — re-running on every spine
    // change would clobber in-progress edits.
    if (demoMode) { setTsTable([]); return undefined; }
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setTsTable([]); // drop the prior org's timesheet on switch; ignore a stale in-flight response
    listTimers(orgId).then((r) => { if (alive) setTsTable(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId, demoMode]);
  const refreshTimesheet = useCallback(() => {
    if (demoMode || !isConfigured() || !orgId) return;
    listTimers(orgId).then(setTsTable).catch(() => {});
  }, [orgId, demoMode]);

  // The timesheet the office/crew see = live editable rows (tsTable) PLUS the
  // imported pay-log historicals (allTimers spine), so every operator's logged
  // time up to today shows. Reactive via memo, so the historicals appear the
  // moment labor_state hydrates — no race with the one-shot listTimers load.
  // Table rows win on any id collision; spine rows are read-only history.
  const timesheet = useMemo(() => {
    const spine = spineTimers.map(tsRowFromSpine);
    if (demoMode) return spine;               // demo has no cloud table
    // timer-table rows carry no rate; resolve each operator's rate so labor $
    // populates (pay = hours × the operator's hourly rate).
    const withRate = tsTable.map((r) => (r.rate ? r : { ...r, rate: techById[r.techId]?.rate || 0 }));
    const seen = new Set(withRate.map((r) => r.dbId || r.id));
    const extra = spine.filter((r) => !seen.has(r.dbId || r.id));
    return [...withRate, ...extra];
  }, [demoMode, tsTable, spineTimers, tsRowFromSpine, techById]);

  const addTimesheet = useCallback(async (row) => {
    const local = {
      // attribute to the logging operator (cloud rows key techId off operator_id;
      // matching it here means split-day / log-work hours attribute + rate-resolve
      // immediately, not just after a re-fetch)
      id: 'ts_' + Math.random().toString(36).slice(2, 10), dbId: null,
      operatorId: operatorId || null, techId: operatorId || null,
      date: row.date, createdAt: new Date().toISOString(),
      propLabel: row.propLabel || 'Unassigned', unit: row.unit || '',
      category: row.category || 'general', note: row.note || '',
      durationHrs: Number(row.durationHrs) || 0, workOrderId: row.workOrderId || null,
      verified: null, distanceM: null, rate: row.rate || 0, source: 'manual',
    };
    setTsTable((l) => [local, ...l]);
    const connected = !demoMode && isConfigured() && orgId;
    let synced = false;
    if (connected && operatorId) {
      try {
        const id = await insertTimer(orgId, operatorId, {
          propLabel: local.propLabel, unit: local.unit || null, date: local.date,
          category: local.category, issue: local.note || null, durationHrs: local.durationHrs,
          note: local.note || null, workOrderId: local.workOrderId,
        });
        setTsTable((l) => l.map((x) => (x.id === local.id ? { ...x, dbId: id } : x)));
        audit('add_timesheet', `${local.propLabel} · ${local.durationHrs}h`);
        synced = true;
      } catch { /* keep local */ }
    }
    // connected but no operator seat → the timers table (operator_id NOT NULL)
    // rejects the row, so it only lives this session and vanishes on the next
    // reload. Flag it so the caller can tell the user instead of losing it silently.
    return { ...local, synced, needsOperator: connected && !operatorId };
  }, [demoMode, orgId, operatorId]); // audit resolved via closure (defined below)

  const updateTimesheet = useCallback(async (id, patch) => {
    setTsTable((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const row = tsTableRef.current.find((x) => x.id === id);
    if (!demoMode && isConfigured() && row?.dbId) {
      try {
        await updateTimer(row.dbId, {
          propLabel: patch.propLabel, unit: patch.unit === '' ? null : patch.unit,
          category: patch.category, durationHrs: patch.durationHrs, note: patch.note, date: patch.date,
        });
        audit('edit_timesheet', `${patch.propLabel ?? row.propLabel} · ${patch.durationHrs ?? row.durationHrs}h`);
      } catch { /* keep local */ }
    }
  }, [demoMode]); // audit resolved via closure (defined below)

  const deleteTimesheet = useCallback(async (id) => {
    const row = tsTableRef.current.find((x) => x.id === id);
    setTsTable((l) => l.filter((x) => x.id !== id));
    if (!demoMode && isConfigured() && row?.dbId) {
      // the cloud row is the source of truth: if the delete fails, restore the row
      // rather than let a refresh silently resurrect it as if never deleted.
      try { await deleteTimer(row.dbId); audit('delete_timesheet', row.propLabel || id); }
      catch { setTsTable((l) => (l.some((x) => x.id === id) ? l : [row, ...l])); return { ok: false }; }
    }
    return { ok: true };
  }, [demoMode]); // audit resolved via closure (defined below)

  // ---- documents: DB+storage only (no meaningful local fallback for files) ----
  const [documents, setDocuments] = useState([]);
  const [docBackend, setDocBackend] = useState('none'); // 'db' | 'none'
  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setDocuments([]);
    listDocuments(orgId)
      .then((rows) => { if (alive) { setDocuments(rows); setDocBackend('db'); } })
      .catch(() => { if (alive) setDocBackend('none'); });
    return () => { alive = false; };
  }, [orgId]);

  const addDocument = useCallback(async (file, opts) => {
    const doc = await uploadDocument(orgId, file, opts); // throws if storage not ready
    setDocuments((l) => [doc, ...l]);
    return doc;
  }, [orgId]);

  // ---- live presence: who's on the clock (crew timers → office board) ----
  const [liveTimers, setLiveTimers] = useState([]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setLiveTimers([]);
    const refresh = () => listLiveTimers(orgId).then((r) => { if (alive) setLiveTimers(r); }).catch(() => {});
    refresh();
    const unsub = subscribeLiveTimers(orgId, refresh);
    return () => { alive = false; if (typeof unsub === 'function') unsub(); };
  }, [orgId]);

  // Field timer calls this: pass the running session (or null on stop) to
  // broadcast/clear this operator's presence.
  const syncLivePresence = useCallback((info) => {
    if (!isConfigured() || !orgId) return;
    if (info) upsertLiveTimer(orgId, { ...info, operatorLabel: myName }).catch(() => {});
    else deleteLiveTimer(orgId).catch(() => {});
  }, [orgId, myName]);

  // ---- availability: on shift / off / PTO (feeds the Day board) ----
  const [availability, setAvail] = useState([]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setAvail([]);
    const refresh = () => listAvailability(orgId).then((r) => { if (alive) setAvail(r); }).catch(() => {});
    refresh();
    const unsub = subscribeAvailability(orgId, refresh);
    return () => { alive = false; if (typeof unsub === 'function') unsub(); };
  }, [orgId]);
  const setMyAvailability = useCallback(async (status, note) => {
    if (!isConfigured() || !orgId) return;
    await setAvailability(orgId, { label: myName, status, note }).catch(() => {});
  }, [orgId, myName]);

  // audit: record a sensitive action (best-effort, unforgeable actor server-side)
  const audit = useCallback((action, target, meta) => {
    if (isConfigured() && orgId) logAudit(orgId, action, target, myName, meta);
  }, [orgId, myName]);

  // ---- leasing spine: the rent roll that replaces the lease spreadsheet ----
  // office (admin/manager) edits; owners (viewer) read. Field crew never see it.
  const canSeeLeasing = role === 'admin' || role === 'manager' || role === 'viewer';
  const [leasing, setLeasing] = useState(() => (demoMode ? DEMO_LEASING : []));
  const leaseRef = useRef(leasing);
  useEffect(() => { leaseRef.current = leasing; }, [leasing]);
  const loadLeasing = useCallback(() => {
    if (!isConfigured() || !orgId || !canSeeLeasing) return;
    listLeasing(orgId).then(setLeasing).catch(() => {});
  }, [orgId, canSeeLeasing]);
  useEffect(() => {
    if (demoMode || !isConfigured() || !orgId || !canSeeLeasing) return undefined;
    let alive = true;
    setLeasing([]); // clear the prior org's rent roll on switch; drop a stale in-flight response
    listLeasing(orgId).then((r) => { if (alive) setLeasing(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId, canSeeLeasing, demoMode]);

  // edit a rent-roll cell — rent/renewal/notes/tenant live on the lease,
  // status lives on the unit. Optimistic locally, persisted in the cloud.
  const setLeaseField = useCallback(async (unitId, patch) => {
    setLeasing((l) => l.map((u) => (u.id === unitId ? { ...u, ...patch } : u)));
    if (!isConfigured() || !orgId || demoMode) return;
    const u = leaseRef.current.find((x) => x.id === unitId);
    const lp = {}, up = {};
    for (const k of ['rent', 'renewalStatus', 'notes', 'tenant', 'phone', 'deposit', 'leaseStart', 'leaseEnd']) if (k in patch) lp[k] = patch[k];
    for (const k of ['status', 'number', 'beds', 'type', 'furnished']) if (k in patch) up[k] = patch[k];
    try {
      if (Object.keys(lp).length && u?.leaseId) await updateLeaseRow(u.leaseId, lp);
      if (Object.keys(up).length) await updateUnitRow(unitId, up);
    } catch { /* keep local copy */ }
  }, [orgId, demoMode]);

  // create a unit in a building (returns its id so the UI can open its editor)
  const addUnit = useCallback(async (building) => {
    const draft = {
      id: 'nu_' + Math.random().toString(36).slice(2, 9), leaseId: null, building,
      number: '', beds: null, type: 'residential', furnished: false, status: 'vacant',
      tenant: '', phone: '', rent: null, fees: {}, total: null, deposit: null,
      leaseStart: null, leaseEnd: null, renewalStatus: null, notes: '',
    };
    if (!isConfigured() || !orgId || demoMode) { setLeasing((l) => [...l, draft]); return draft.id; }
    try {
      const saved = await addUnitWithLease(orgId, draft);
      setLeasing((l) => [...l, saved]); audit('add_unit', building); return saved.id;
    } catch { setLeasing((l) => [...l, draft]); return draft.id; }
  }, [orgId, demoMode, audit]);

  const removeUnit = useCallback(async (unitId) => {
    setLeasing((l) => l.filter((u) => u.id !== unitId));
    if (isConfigured() && orgId && !demoMode && !String(unitId).startsWith('nu_')) {
      try { await deleteUnit(unitId); audit('delete_unit', unitId); } catch { /* already gone locally */ }
    }
  }, [orgId, demoMode, audit]);

  // wipe the current rent roll (units + leases). Buildings stay so a re-import reuses them.
  const clearLeasing = useCallback(async () => {
    if (!isConfigured() || !orgId || demoMode) { setLeasing([]); return; }
    setLeasing([]);
    try { await clearLeasingDb(orgId); audit('clear_leasing', 'rent roll cleared'); } catch { loadLeasing(); }
  }, [orgId, demoMode, loadLeasing, audit]);

  const importLeases = useCallback(async (buildings, { replace = false } = {}) => {
    if (!isConfigured() || !orgId) return { buildings: 0, units: 0 };
    // replace = wipe the existing roll first, so re-importing doesn't duplicate every unit
    if (replace) { try { await clearLeasingDb(orgId); } catch { /* proceed — import still runs */ } }
    const res = await importLeaseBuildings(orgId, buildings);
    loadLeasing();
    audit(replace ? 'replace_leases' : 'import_leases', `${res.buildings} buildings · ${res.units} units`);
    return res;
  }, [orgId, loadLeasing, audit]);

  // ---- vendors: approved contractor/supplier rolodex + favorite products ----
  // any member can read; staff (admin/manager, incl. owner-admins) maintain it.
  const canEditVendors = role === 'admin' || role === 'manager';
  const [vendors, setVendors] = useState(() => (demoMode ? DEMO_VENDORS : []));
  const [vendorProducts, setVendorProducts] = useState(() => (demoMode ? DEMO_VENDOR_PRODUCTS : []));
  const vendorsRef = useRef(vendors);
  useEffect(() => { vendorsRef.current = vendors; }, [vendors]);
  const vendorProductsRef = useRef(vendorProducts);
  useEffect(() => { vendorProductsRef.current = vendorProducts; }, [vendorProducts]);
  const loadVendors = useCallback(() => {
    if (!isConfigured() || !orgId) return;
    listVendors(orgId).then(setVendors).catch(() => {});
    listVendorProducts(orgId).then(setVendorProducts).catch(() => {});
  }, [orgId]);
  useEffect(() => {
    if (demoMode || !isConfigured() || !orgId) return undefined;
    let alive = true;
    setVendors([]); setVendorProducts([]); // drop the prior org's rolodex on switch
    listVendors(orgId).then((r) => { if (alive) setVendors(r); }).catch(() => {});
    listVendorProducts(orgId).then((r) => { if (alive) setVendorProducts(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId, demoMode]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    return subscribeVendors(orgId, loadVendors);
  }, [orgId, loadVendors]);

  const saveVendor = useCallback(async (v) => {
    if (v.id && !String(v.id).startsWith('nv_')) {
      setVendors((l) => l.map((x) => (x.id === v.id ? { ...x, ...v } : x)));
      if (isConfigured() && orgId && !demoMode) { try { await updateVendor(v.id, v); audit('update_vendor', v.name); } catch { /* keep local */ } }
      return v.id;
    }
    const draft = { id: 'nv_' + Math.random().toString(36).slice(2, 9), approved: true, favorite: false, kind: 'contractor', trade: '', ...v };
    if (!isConfigured() || !orgId || demoMode) { setVendors((l) => [...l, draft]); return draft.id; }
    try { const saved = await addVendor(orgId, draft); setVendors((l) => [...l, saved]); audit('add_vendor', saved.name); return saved.id; }
    catch { setVendors((l) => [...l, draft]); return draft.id; }
  }, [orgId, demoMode, audit]);
  const removeVendor = useCallback(async (id) => {
    setVendors((l) => l.filter((x) => x.id !== id));
    if (isConfigured() && orgId && !demoMode && !String(id).startsWith('nv_')) { try { await deleteVendor(id); audit('delete_vendor', id); } catch { /* gone */ } }
  }, [orgId, demoMode, audit]);
  const setVendorField = useCallback(async (id, patch) => {
    // updateVendor writes every column, so send the full merged record. Build it
    // from the ref (always current) — NOT from a setState side-effect, which only
    // runs on React's eager path and is undefined mid-reload → would blank the row.
    setVendors((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const merged = { ...vendorsRef.current.find((x) => x.id === id), ...patch };
    if (isConfigured() && orgId && !demoMode && !String(id).startsWith('nv_')) { try { await updateVendor(id, merged); } catch { /* keep */ } }
  }, [orgId, demoMode]);

  const saveProduct = useCallback(async (p) => {
    if (p.id && !String(p.id).startsWith('np_')) {
      setVendorProducts((l) => l.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
      if (isConfigured() && orgId && !demoMode) { try { await updateVendorProduct(p.id, p); } catch { /* keep */ } }
      return p.id;
    }
    const draft = { id: 'np_' + Math.random().toString(36).slice(2, 9), favorite: true, ...p };
    if (!isConfigured() || !orgId || demoMode) { setVendorProducts((l) => [...l, draft]); return draft.id; }
    try { const saved = await addVendorProduct(orgId, draft); setVendorProducts((l) => [...l, saved]); return saved.id; }
    catch { setVendorProducts((l) => [...l, draft]); return draft.id; }
  }, [orgId, demoMode]);
  const removeProduct = useCallback(async (id) => {
    setVendorProducts((l) => l.filter((x) => x.id !== id));
    if (isConfigured() && orgId && !demoMode && !String(id).startsWith('np_')) { try { await deleteVendorProduct(id); } catch { /* gone */ } }
  }, [orgId, demoMode]);
  const setProductField = useCallback(async (id, patch) => {
    setVendorProducts((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const merged = { ...vendorProductsRef.current.find((x) => x.id === id), ...patch };
    if (isConfigured() && orgId && !demoMode && !String(id).startsWith('np_')) { try { await updateVendorProduct(id, merged); } catch { /* keep */ } }
  }, [orgId, demoMode]);

  // ---- per-property credit cards: auto-file receipts by card ----
  const [cards, setCards] = useState(() => (isConfigured() ? [] : loadLS('caliper_cards_v1', [])));
  const [cardBackend, setCardBackend] = useState('local');
  useEffect(() => { if (cardBackend !== 'db') saveLS('caliper_cards_v1', cards); }, [cards, cardBackend]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setCards([]);
    listPropertyCards(orgId).then((rows) => { if (alive) { setCards(rows); setCardBackend('db'); } }).catch(() => { if (alive) setCardBackend('local'); });
    return () => { alive = false; };
  }, [orgId]);

  const addCard = useCallback(async (c) => {
    const last4 = String(c.last4 || '').replace(/\D/g, '').slice(-4);
    if (last4.length !== 4 || !c.propLabel) return null;
    const local = { ...c, last4, id: 'card_' + Math.random().toString(36).slice(2, 9) };
    setCards((l) => [...l, local]);
    if (isConfigured() && orgId && cardBackend === 'db') {
      try { const saved = await insertPropertyCard(orgId, { ...c, last4 }); if (saved?.id) setCards((l) => l.map((x) => (x.id === local.id ? saved : x))); return saved; }
      catch { /* keep local */ }
    }
    return local;
  }, [orgId, cardBackend]);

  const removeCard = useCallback((id) => {
    setCards((l) => l.filter((x) => x.id !== id));
    if (isConfigured() && cardBackend === 'db' && !String(id).startsWith('card_')) deletePropertyCard(id).catch(() => {});
  }, [cardBackend]);

  // last4 → the property that card belongs to
  const matchCard = useCallback((last4) => {
    const l4 = String(last4 || '').replace(/\D/g, '').slice(-4);
    return l4 ? cards.find((c) => c.last4 === l4) || null : null;
  }, [cards]);

  // ---- team comms: Slack-style messages + voice notes ----
  const [messages, setMessages] = useState(() => (isConfigured() ? [] : loadLS(MSG_KEY, [])));
  const [msgBackend, setMsgBackend] = useState('local'); // 'db' | 'local'
  useEffect(() => { if (msgBackend === 'local') saveLS(MSG_KEY, messages.slice(-300)); }, [messages, msgBackend]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return undefined;
    let alive = true;
    setMessages([]); // drop the prior org's thread on switch; ignore a stale in-flight response
    listMessages(orgId)
      .then((rows) => { if (alive) { setMessages(rows); setMsgBackend('db'); } })
      .catch(() => { if (alive) setMsgBackend('local'); }); // table not migrated yet → keep local
    return () => { alive = false; };
  }, [orgId]);

  // realtime: new messages stream in live (dedupe against optimistic copies)
  useEffect(() => {
    if (!isConfigured() || !orgId || msgBackend !== 'db') return undefined;
    return subscribeMessages(orgId, (m) => {
      setMessages((l) => {
        if (l.some((x) => x.id === m.id)) return l; // already have the saved row (insert remap won the race)
        // my own just-sent message can arrive here before insertMessage resolves — upgrade the
        // optimistic copy in place instead of appending a duplicate (which would collide on db id)
        const pi = l.findIndex((x) => String(x.id).startsWith('msg_') && x.senderId === m.senderId
          && (x.body || null) === (m.body || null) && Math.abs(new Date(x.createdAt) - new Date(m.createdAt)) < 15000);
        if (pi >= 0) { const copy = [...l]; copy[pi] = m; return copy; }
        return [...l, m];
      });
    });
  }, [orgId, msgBackend]);

  // post a message: typed body and/or a recorded voice note (Blob).
  const addMessage = useCallback(async ({ channel = 'all', body, voiceBlob, voiceSecs, attachFile, workOrderId } = {}) => {
    const base = {
      channel, body: body?.trim() || null, workOrderId: workOrderId || null,
      sender: myName, senderRole: myCommsRole, voiceSecs: voiceSecs || null,
    };
    const isImg = attachFile && (attachFile.type || '').startsWith('image/');
    // local/demo: keep the voice/attachment inline as a data URL so it renders + persists
    if (!isConfigured() || !orgId || msgBackend !== 'db') {
      const voiceData = voiceBlob ? await blobToDataUrl(voiceBlob) : null;
      const attData = attachFile ? await blobToDataUrl(attachFile) : null;
      const local = {
        ...base, id: 'msg_' + Math.random().toString(36).slice(2, 10), senderId: myId, voiceData,
        imageData: isImg ? attData : null,
        fileData: attachFile && !isImg ? attData : null, fileName: attachFile && !isImg ? attachFile.name : null,
        createdAt: new Date().toISOString(),
      };
      setMessages((l) => [...l, local]);
      return local;
    }
    // cloud: upload the voice note / attachment, then insert the row
    let voicePath = null, imagePath = null, filePath = null, fileName = null;
    if (voiceBlob) { try { voicePath = await uploadVoiceNote(orgId, voiceBlob); } catch { /* text still sends */ } }
    if (attachFile) {
      try {
        const path = await uploadAttachment(orgId, attachFile);
        if (isImg) imagePath = path; else { filePath = path; fileName = attachFile.name || 'file'; }
      } catch { /* text still sends */ }
    }
    const local = { ...base, id: 'msg_' + Math.random().toString(36).slice(2, 10), senderId: myId, voicePath, imagePath, filePath, fileName, createdAt: new Date().toISOString() };
    setMessages((l) => [...l, local]);
    try {
      const saved = await insertMessage(orgId, { ...base, voicePath, imagePath, filePath, fileName });
      if (saved?.id) setMessages((l) => l.map((x) => (x.id === local.id ? saved : x)));
      return saved;
    } catch { return local; }
  }, [orgId, msgBackend, myId, myName, myCommsRole]);

  // AI: turn a thread into a work-order summary/update (server-side Claude)
  const summarizeMessages = useCallback(async (msgs, workOrder) => {
    if (!isConfigured()) throw new Error('Connect to the cloud to use AI summaries.');
    return summarizeThread(msgs.map((m) => ({ sender: m.sender, role: m.senderRole, body: m.body })), workOrder);
  }, []);

  // ---- chat directory + private channels (DMs / groups) ----
  const [chatMembers, setChatMembers] = useState([]);           // real app users (db)
  const [dbChannels, setDbChannels] = useState([]);             // my DMs/groups (db)
  const [localChannels, setLocalChannels] = useState(() => loadLS(CHAN_KEY, [])); // demo mode

  useEffect(() => {
    if (!isConfigured() || !orgId || msgBackend !== 'db') return undefined;
    let alive = true;
    upsertChatMember(orgId, { label: myName, role: myCommsRole }).catch(() => {});
    listChatMembers(orgId).then((r) => { if (alive) setChatMembers(r); }).catch(() => {});
    listChatChannels(orgId).then((r) => { if (alive) setDbChannels(r); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId, msgBackend, myName, myCommsRole]);

  // who you can start a conversation with. Cloud: real app users (by uid).
  // Demo/local: the crew roster so the feature is usable without logins.
  const roster = useMemo(() => {
    if (isConfigured() && msgBackend === 'db') return chatMembers.filter((m) => m.id !== myId);
    return activeTechs.map((t) => ({ id: t.id, label: t.name, role: t.role === 'tech' ? 'crew' : 'office' }))
      .filter((p) => p.label && p.label !== myName);
  }, [chatMembers, activeTechs, msgBackend, myId, myName]);

  const privateChannels = isConfigured() && msgBackend === 'db' ? dbChannels : localChannels;

  // create a DM (one member) or named group (several) → returns its channel id
  const addChannel = useCallback(async ({ kind, members, name }) => {
    const memberLabels = [myName, ...members.map((m) => m.label)];
    if (isConfigured() && orgId && msgBackend === 'db') {
      // only real auth-user ids are valid participants for a private channel
      const memberIds = [myId, ...members.map((m) => m.id)].filter((id) => id && /^[0-9a-f-]{36}$/i.test(id));
      try {
        const ch = await insertChatChannel(orgId, { kind, name, memberIds, memberLabels });
        setDbChannels((l) => [...l, ch]);
        return ch.id;
      } catch { /* fall through to a local channel */ }
    }
    const ch = { id: 'lch:' + Math.random().toString(36).slice(2, 9), kind, name: name || null,
      memberIds: [myId, ...members.map((m) => m.id)], memberLabels };
    setLocalChannels((l) => { const nl = [...l, ch]; localStorage.setItem(CHAN_KEY, JSON.stringify(nl)); return nl; });
    return ch.id;
  }, [orgId, msgBackend, myId, myName]);

  // ---- one-tap demo fill: labor spine (local) + work orders/purchases (DB) ----
  // Flows through the same write paths as real data, so what you see is exactly
  // what the app produces. Additive-safe: labor is replaced (no compounding),
  // orders/purchases only seed when empty so re-tapping never duplicates them.
  const loadSampleData = useCallback(async (opts = {}) => {
    const owner = opts.kind === 'owner';

    // Rent roll — the portfolio spine (both personas). Seed only when empty so
    // re-tapping never duplicates. In the cloud this persists to units+leases;
    // in demo mode the rent roll already defaults to the same sample.
    if ((leaseRef.current?.length || 0) === 0) {
      if (isConfigured() && orgId) await importLeases(DEMO_PORTFOLIO).catch(() => {});
      else setLeasing(DEMO_LEASING);
    }

    // Approved vendors + favorite products (both personas). Seed only when empty;
    // remap demo product→vendor links onto the freshly created vendor ids.
    if (vendorsRef.current.length === 0) {
      if (isConfigured() && orgId && !demoMode) {
        const idMap = {};
        for (const v of DEMO_VENDORS) { try { idMap[v.id] = await saveVendor({ ...v, id: undefined }); } catch { /* skip */ } }
        for (const p of DEMO_VENDOR_PRODUCTS) { try { await saveProduct({ ...p, id: undefined, vendorId: idMap[p.vendorId] || null }); } catch { /* skip */ } }
      } else { setVendors(DEMO_VENDORS); setVendorProducts(DEMO_VENDOR_PRODUCTS); }
    }

    let timerCount = 0;
    if (owner) {
      // Owner persona: a portfolio, not a maintenance company. Skip the labor
      // spine / crew apparatus; seed a couple of maintenance items + expenses
      // pinned to the portfolio's own buildings so those tabs aren't empty.
      const OWNER_WOS = [
        { task: 'Unit 2A turnover — paint + patch before showing', propLabel: 'Parkview Lofts', unit: '2A', category: 'painting', priority: 2, status: 'open', source: 'manual' },
        { task: 'No heat — furnace not igniting', propLabel: '210 Water Street', unit: '3', category: 'hvac', priority: 1, status: 'open', source: 'manual' },
        { task: 'Annual gutter cleaning', propLabel: '88 Maple Row', unit: '—', category: 'general', priority: 4, status: 'done', source: 'manual' },
      ];
      const OWNER_PURCHASES = [
        { vendor: 'Home Depot', amount: 62.41, propLabel: 'Parkview Lofts', note: 'paint + patching supplies for 2A turnover' },
        { vendor: 'Lowe’s', amount: 148.9, propLabel: '210 Water Street', note: 'furnace igniter + thermocouple' },
      ];
      if (woRef.current.length === 0) for (const wo of OWNER_WOS) await addWorkOrder(wo);
      if (purchases.length === 0) {
        const saved = [];
        for (const p of OWNER_PURCHASES) saved.push(await addPurchase(p));
        saved.forEach((s) => s?.id && setPurchaseStatus(s.id, 'approved'));
      }
    } else {
      // Company persona: full operation — properties + labor spine + orders + purchases.
      const map = ensureProperties(DEMO_PROPERTIES.map((p) => p.label));
      const rows = buildDemoTimers().map((r) => ({ ...r, propId: r.propLabel ? map[r.propLabel] : null }));
      addImported(rows, { replace: true });
      timerCount = rows.length;

      if (woRef.current.length === 0) for (const wo of DEMO_WORK_ORDERS) await addWorkOrder(wo);
      if (purchases.length === 0) {
        const saved = [];
        for (const p of DEMO_PURCHASES) saved.push(await addPurchase(p));
        saved.slice(0, 2).forEach((s) => s?.id && setPurchaseStatus(s.id, 'approved'));
      }
    }
    return { timers: timerCount };
  }, [ensureProperties, addImported, addWorkOrder, addPurchase, setPurchaseStatus, purchases.length, importLeases, orgId, setLeasing, demoMode, saveVendor, saveProduct]);

  // go-live reset: clear this workspace's test/operational data. Local always;
  // cloud rows too when connected. Portfolio (rent roll + vendors) is preserved
  // unless includePortfolio is set.
  const resetWorkspace = useCallback(async ({ cloud = true, includePortfolio = false } = {}) => {
    [IMP_KEY, WO_KEY, PUR_KEY, PROP_KEY, TQ_KEY, MSG_KEY, CHAN_KEY, 'caliper_cards_v1', 'caliper_salaries_v1']
      .forEach((k) => { try { localStorage.removeItem(k); } catch { /* no storage */ } });
    clearImported();
    setWorkOrders([]); setPurchases([]); setMessages([]); setCards([]); setTsTable([]); setDocuments([]);
    // clear pay config too so a "clear test data" reset can't leave salaries or
    // P&L inputs behind (and the write-through can't re-upload them to the cloud)
    setSalaries({});
    setPlAll((a) => { const nxt = { ...a }; delete nxt[plKey]; return nxt; });
    if (includePortfolio) { setLeasing([]); setVendors([]); setVendorProducts([]); }
    let result = null;
    if (cloud && isConfigured() && orgId && !demoMode) {
      try { result = await wipeOrgData(orgId, { includePortfolio }); audit('reset_workspace', includePortfolio ? 'all data' : 'operational data'); }
      catch { /* local clear already applied */ }
    }
    return result;
  }, [orgId, demoMode, clearImported, audit, plKey]);

  // notification badges: items created since the tab was last opened
  const badges = useMemo(() => {
    const newer = (items, key) => items.filter((it) => it.createdAt && new Date(it.createdAt).getTime() > (seen[key] || 0)).length;
    // chat: unread messages from others (never badge your own)
    const chatUnread = messages.filter((m) => m.createdAt && new Date(m.createdAt).getTime() > (seen.chat || 0) && m.senderId !== myId).length;
    return {
      wo: newer(workOrders, 'wo'),
      pur: newer(purchases.filter((p) => p.status === 'pending'), 'pur'),
      docs: newer(documents, 'docs'),
      chat: chatUnread,
    };
  }, [workOrders, purchases, documents, messages, seen, myId]);

  return {
    meta: { ...seed.meta, org: (isConfigured() && orgName) ? orgName : seed.meta.org },
    properties,
    pickProperties,
    cloudProps,
    techs,
    activeTechs,
    operators, setOperatorRate,
    inactiveOps, setOperatorActive,
    allTimers,
    timers,
    range, setRange,
    propById, techById,
    role,
    // import
    addImported, clearImported, ensureProperties, loadSampleData, allocateImported,
    laborBackend,
    hasImported: imported.timers.length > 0,
    importedCount: imported.timers.length,
    // work orders
    workOrders, addWorkOrder, setWoStatus, setWoPriority, setWoAssignee, setWoBilling, addWoAttachment, woBackend,
    woNotice, clearWoNotice: () => setWoNotice(null),
    // cloud timers
    addTimerEntry, updateTimerEntry, deleteTimerEntry, operatorId,
    // timesheet (editable log history)
    timesheet, addTimesheet, updateTimesheet, deleteTimesheet, refreshTimesheet,
    // salaried operators
    salaries, setSalary,
    // P&L statement config
    plConfig, setPlLine,
    // go-live reset
    resetWorkspace,
    leasing, setLeaseField, importLeases, clearLeasing, loadLeasing, canSeeLeasing, addUnit, removeUnit,
    setBuildingLocation,
    vendors, vendorProducts, canEditVendors, saveVendor, removeVendor, setVendorField,
    saveProduct, removeProduct, setProductField,
    // live presence + availability + audit
    liveTimers, syncLivePresence,
    availability, setMyAvailability, audit,
    // purchases
    purchases, addPurchase, setPurchaseStatus, purBackend,
    // per-property cards
    cards, addCard, removeCard, matchCard,
    // documents
    documents, addDocument, docBackend,
    // team comms
    messages, addMessage, msgBackend, summarizeMessages, myName, myId,
    roster, privateChannels, addChannel,
    // nav notification badges
    badges, markSeen,
  };
}
