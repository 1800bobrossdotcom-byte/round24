import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import seed from '../data/seed.json';
import { useAuth } from '../components/AuthGate.jsx';
import { DEMO_PROPERTIES, buildDemoTimers, DEMO_WORK_ORDERS, DEMO_PURCHASES } from './demoData.js';
import {
  isConfigured, listWorkOrders, insertWorkOrder, updateWorkOrderStatus,
  updateWorkOrderPriority, updateWorkOrderAssignee, subscribeWorkOrders,
  listPurchases, insertPurchase, setPurchaseStatus as dbSetPurchaseStatus, uploadReceipt,
  listDocuments, uploadDocument,
  listMessages, insertMessage, subscribeMessages, uploadVoiceNote, summarizeThread,
  uploadAttachment, updateWorkOrderPhotos, updateWorkOrderFiles,
  upsertChatMember, listChatMembers, listChatChannels, insertChatChannel,
  listPropertyCards, insertPropertyCard, deletePropertyCard,
  listLiveTimers, upsertLiveTimer, deleteLiveTimer, subscribeLiveTimers,
  getLaborState, saveLaborState,
  listAvailability, setAvailability, subscribeAvailability, logAudit,
  fetchMyOperatorId, insertTimer, insertProperties, getUserSettings,
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

// One-time purge of pre-fix imported caches. Older builds appended every
// upload, so browsers carry compounded test data that a code deploy can't
// reach. Bump SCHEMA_VERSION to force every client to start clean on load.
const SCHEMA_KEY = 'caliper_import_schema';
const SCHEMA_VERSION = '3';   // bump: prior imports may reference gated seed operator ids
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(SCHEMA_KEY) !== SCHEMA_VERSION) {
    localStorage.removeItem(IMP_KEY);
    localStorage.removeItem(PROP_KEY);
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
  const [imported, setImported] = useState(() => loadLS(IMP_KEY, { timers: [], techs: [] }));
  useEffect(() => { localStorage.setItem(IMP_KEY, JSON.stringify(imported)); }, [imported]);

  // ---- nav notification badges: count items newer than the last time the
  // user opened that tab. Seed stamps to "now" on first run so pre-existing
  // items don't all badge. markSeen(tab) clears a tab's badge on open.
  const [seen, setSeen] = useState(() => loadLS(SEEN_KEY, null) || { wo: Date.now(), pur: Date.now(), docs: Date.now(), chat: Date.now() });
  useEffect(() => { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); }, [seen]);
  const markSeen = useCallback((tab) => {
    if (!['wo', 'pur', 'docs', 'chat'].includes(tab)) return;
    setSeen((s) => ({ ...s, [tab]: Date.now() }));
  }, []);

  // seed.json is SAMPLE data for the unconfigured demo experience only. A
  // real, logged-in org must never see it mixed into its charts — it sees
  // only its own imported/real data.
  const demoMode = !isConfigured();
  const techs = useMemo(() => [...(demoMode ? seed.techs : []), ...imported.techs], [imported.techs, demoMode]);
  const allTimers = useMemo(() => [...(demoMode ? seed.timers : []), ...imported.timers], [imported.timers, demoMode]);

  const [range, setRange] = useState({ from: '2026-05-11', to: '2026-07-05' });

  // ---- buildings discovered from imports (non-integrated shops start empty) ----
  const [impProps, setImpProps] = useState(() => loadLS(PROP_KEY, []));
  useEffect(() => { localStorage.setItem(PROP_KEY, JSON.stringify(impProps)); }, [impProps]);
  const impPropsRef = useRef(impProps);
  useEffect(() => { impPropsRef.current = impProps; }, [impProps]);

  // ---- cloud labor persistence: the spine follows the account (staff only) ----
  // localStorage is the fast local cache; when connected, this org record is the
  // source of truth so dashboards/team/properties are the same on every device.
  const [laborBackend, setLaborBackend] = useState('local');
  const hydratedRef = useRef(false);
  const isStaffMember = role === 'admin' || role === 'manager';
  useEffect(() => {
    if (!isConfigured() || !orgId || !isStaffMember) { hydratedRef.current = true; return; }
    getLaborState(orgId).then((s) => {
      if (s) {
        if (s.imported && (s.imported.timers?.length || s.imported.techs?.length)) setImported(s.imported);
        if (Array.isArray(s.props)) { impPropsRef.current = s.props; setImpProps(s.props); }
        if (s.range?.from && s.range?.to) setRange(s.range);
      }
      setLaborBackend('db');
      hydratedRef.current = true;
    }).catch(() => { setLaborBackend('local'); hydratedRef.current = true; });
  }, [orgId, isStaffMember]);
  // write-through: after hydration, sync any spine change up (debounced)
  useEffect(() => {
    if (laborBackend !== 'db' || !hydratedRef.current || !orgId || !isStaffMember) return;
    const t = setTimeout(() => { saveLaborState(orgId, { imported, props: impProps, range }).catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [imported, impProps, range, laborBackend, orgId, isStaffMember]);

  const properties = useMemo(() => [...(demoMode ? seed.properties : []), ...impProps], [impProps, demoMode]);
  const propById = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p])), [properties]);
  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t])), [techs]);

  // resolve building labels → ids, creating a native property for any label
  // not already known. Returns { label: id } synchronously so an import can
  // allocate immediately. Best-effort DB insert when connected.
  const ensureProperties = useCallback((labels) => {
    const current = [...(demoMode ? seed.properties : []), ...impPropsRef.current];
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
  }, [orgId]);

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
      setRange((r) => replace ? { from: min, to: max }
        : { from: min < r.from ? min : r.from, to: max > r.to ? max : r.to });
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

  // wipe ALL locally-imported test data: pay-log timers, discovered operators
  // and buildings, and reset the date window. Does not touch DB rows.
  const clearImported = useCallback(() => {
    setImported({ timers: [], techs: [] });   // persistence effects write the empty state
    setImpProps([]); impPropsRef.current = [];
    setRange({ from: '2026-05-11', to: '2026-07-05' });
  }, []);

  // ---- work orders: DB-backed when connected, localStorage otherwise ----
  const [workOrders, setWorkOrders] = useState(() => loadLS(WO_KEY, []));
  const [woBackend, setWoBackend] = useState('local'); // 'db' | 'local'
  useEffect(() => { localStorage.setItem(WO_KEY, JSON.stringify(workOrders)); }, [workOrders]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    listWorkOrders(orgId)
      .then((rows) => { setWorkOrders(rows); setWoBackend('db'); })
      .catch(() => setWoBackend('local')); // table not migrated yet → keep local
  }, [orgId]);

  const addWorkOrder = useCallback(async (wo) => {
    const local = { ...wo, id: 'wo_' + Math.random().toString(36).slice(2, 10), status: wo.status || 'open', createdAt: new Date().toISOString() };
    setWorkOrders((l) => [local, ...l]);
    if (isConfigured() && orgId && woBackend === 'db') {
      try {
        const saved = await insertWorkOrder(orgId, local);
        if (saved?.id) setWorkOrders((l) => l.map((w) => (w.id === local.id ? saved : w)));
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
          category: n.category, assigneeLabel: n.assignee_label, due: n.due_date,
          status: n.status, priority: n.priority ?? 3, source: n.source, createdAt: n.created_at,
        };
        if (!woRef.current.some((w) => w.id === wo.id)) {
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
          ? { ...w, status: upd.status, priority: upd.priority ?? 3, due: upd.due_date, task: upd.task, assigneeLabel: upd.assignee_label }
          : w)));
      } else if (eventType === 'DELETE' && payload.old?.id) {
        setWorkOrders((l) => l.filter((w) => w.id !== payload.old.id));
      }
    });
  }, [orgId, woBackend]);

  // ---- purchases: DB-backed when connected, localStorage otherwise ----
  const [purchases, setPurchases] = useState(() => loadLS(PUR_KEY, []));
  const [purBackend, setPurBackend] = useState('local');
  useEffect(() => { localStorage.setItem(PUR_KEY, JSON.stringify(purchases)); }, [purchases]);
  const purchasesRef = useRef(purchases);
  useEffect(() => { purchasesRef.current = purchases; }, [purchases]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    listPurchases(orgId)
      .then((rows) => { setPurchases(rows); setPurBackend('db'); })
      .catch(() => setPurBackend('local'));
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

  const flushTimerQueue = useCallback(async (opId) => {
    if (!isConfigured() || !orgId || !opId) return;
    const queue = loadLS(TQ_KEY, []);
    if (!queue.length) return;
    const remaining = [];
    for (const t of queue) {
      try { await insertTimer(orgId, opId, t); }
      catch { remaining.push(t); }
    }
    localStorage.setItem(TQ_KEY, JSON.stringify(remaining));
  }, [orgId]);

  useEffect(() => { if (operatorId) flushTimerQueue(operatorId); }, [operatorId, flushTimerQueue]);

  // returns 'synced' | 'queued' | 'local'
  const addTimerEntry = useCallback(async (t) => {
    if (!isConfigured() || !orgId) return 'local';               // demo mode
    if (!operatorId) {
      // no operator record linked to this login (e.g. office staff) — queue
      // would never flush, so don't pretend it will sync
      return 'local';
    }
    try { await insertTimer(orgId, operatorId, t); flushTimerQueue(operatorId); return 'synced'; }
    catch {
      localStorage.setItem(TQ_KEY, JSON.stringify([...loadLS(TQ_KEY, []), t]));
      return 'queued';
    }
  }, [orgId, operatorId, flushTimerQueue]);

  // ---- documents: DB+storage only (no meaningful local fallback for files) ----
  const [documents, setDocuments] = useState([]);
  const [docBackend, setDocBackend] = useState('none'); // 'db' | 'none'
  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    listDocuments(orgId)
      .then((rows) => { setDocuments(rows); setDocBackend('db'); })
      .catch(() => setDocBackend('none'));
  }, [orgId]);

  const addDocument = useCallback(async (file, opts) => {
    const doc = await uploadDocument(orgId, file, opts); // throws if storage not ready
    setDocuments((l) => [doc, ...l]);
    return doc;
  }, [orgId]);

  // ---- live presence: who's on the clock (crew timers → office board) ----
  const [liveTimers, setLiveTimers] = useState([]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    const refresh = () => listLiveTimers(orgId).then(setLiveTimers).catch(() => {});
    refresh();
    return subscribeLiveTimers(orgId, refresh);
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
    if (!isConfigured() || !orgId) return;
    const refresh = () => listAvailability(orgId).then(setAvail).catch(() => {});
    refresh();
    return subscribeAvailability(orgId, refresh);
  }, [orgId]);
  const setMyAvailability = useCallback(async (status, note) => {
    if (!isConfigured() || !orgId) return;
    await setAvailability(orgId, { label: myName, status, note }).catch(() => {});
  }, [orgId, myName]);

  // audit: record a sensitive action (best-effort, unforgeable actor server-side)
  const audit = useCallback((action, target, meta) => {
    if (isConfigured() && orgId) logAudit(orgId, action, target, myName, meta);
  }, [orgId, myName]);

  // ---- per-property credit cards: auto-file receipts by card ----
  const [cards, setCards] = useState(() => loadLS('caliper_cards_v1', []));
  const [cardBackend, setCardBackend] = useState('local');
  useEffect(() => { if (cardBackend === 'local') localStorage.setItem('caliper_cards_v1', JSON.stringify(cards)); }, [cards, cardBackend]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    listPropertyCards(orgId).then((rows) => { setCards(rows); setCardBackend('db'); }).catch(() => setCardBackend('local'));
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
  const [messages, setMessages] = useState(() => loadLS(MSG_KEY, []));
  const [msgBackend, setMsgBackend] = useState('local'); // 'db' | 'local'
  useEffect(() => { if (msgBackend === 'local') localStorage.setItem(MSG_KEY, JSON.stringify(messages.slice(-300))); }, [messages, msgBackend]);

  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    listMessages(orgId)
      .then((rows) => { setMessages(rows); setMsgBackend('db'); })
      .catch(() => setMsgBackend('local')); // table not migrated yet → keep local
  }, [orgId]);

  // realtime: new messages stream in live (dedupe against optimistic copies)
  useEffect(() => {
    if (!isConfigured() || !orgId || msgBackend !== 'db') return;
    return subscribeMessages(orgId, (m) => {
      setMessages((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
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
    if (!isConfigured() || !orgId || msgBackend !== 'db') return;
    upsertChatMember(orgId, { label: myName, role: myCommsRole }).catch(() => {});
    listChatMembers(orgId).then(setChatMembers).catch(() => {});
    listChatChannels(orgId).then(setDbChannels).catch(() => {});
  }, [orgId, msgBackend, myName, myCommsRole]);

  // who you can start a conversation with. Cloud: real app users (by uid).
  // Demo/local: the crew roster so the feature is usable without logins.
  const roster = useMemo(() => {
    if (isConfigured() && msgBackend === 'db') return chatMembers.filter((m) => m.id !== myId);
    return techs.map((t) => ({ id: t.id, label: t.name, role: t.role === 'tech' ? 'crew' : 'office' }))
      .filter((p) => p.label && p.label !== myName);
  }, [chatMembers, techs, msgBackend, myId, myName]);

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
  const loadSampleData = useCallback(async () => {
    // 1. properties + labor timers → charts, team, properties
    const map = ensureProperties(DEMO_PROPERTIES.map((p) => p.label));
    const rows = buildDemoTimers().map((r) => ({ ...r, propId: r.propLabel ? map[r.propLabel] : null }));
    addImported(rows, { replace: true });

    // 2. work orders (only if none yet)
    if (woRef.current.length === 0) {
      for (const wo of DEMO_WORK_ORDERS) await addWorkOrder(wo);
    }
    // 3. purchases (only if none yet); approve a couple so History isn't empty
    if (purchases.length === 0) {
      const saved = [];
      for (const p of DEMO_PURCHASES) saved.push(await addPurchase(p));
      saved.slice(0, 2).forEach((s) => s?.id && setPurchaseStatus(s.id, 'approved'));
    }
    return { timers: rows.length };
  }, [ensureProperties, addImported, addWorkOrder, addPurchase, setPurchaseStatus, purchases.length]);

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
    techs,
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
    workOrders, addWorkOrder, setWoStatus, setWoPriority, setWoAssignee, addWoAttachment, woBackend,
    woNotice, clearWoNotice: () => setWoNotice(null),
    // cloud timers
    addTimerEntry, operatorId,
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
