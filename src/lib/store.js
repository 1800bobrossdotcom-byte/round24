import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import seed from '../data/seed.json';
import { useAuth } from '../components/AuthGate.jsx';
import {
  isConfigured, listWorkOrders, insertWorkOrder, updateWorkOrderStatus,
  updateWorkOrderPriority, subscribeWorkOrders,
  listPurchases, insertPurchase, setPurchaseStatus as dbSetPurchaseStatus, uploadReceipt,
  listDocuments, uploadDocument,
  fetchMyOperatorId, insertTimer,
} from './backend/supabase.js';

const IMP_KEY = 'caliper_imported_v1';
const WO_KEY = 'caliper_workorders_v1';
const PUR_KEY = 'caliper_purchases_v1';
const TQ_KEY = 'caliper_timerqueue_v1';   // offline queue for unsynced timer entries

function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

const slugTech = (name) =>
  't_imp_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function useStore() {
  const { orgId, role } = useAuth();

  // ---- imported pay-log data (merged into the same spine the charts read) ----
  const [imported, setImported] = useState(() => loadLS(IMP_KEY, { timers: [], techs: [] }));
  useEffect(() => { localStorage.setItem(IMP_KEY, JSON.stringify(imported)); }, [imported]);

  const techs = useMemo(() => [...seed.techs, ...imported.techs], [imported.techs]);
  const allTimers = useMemo(() => [...seed.timers, ...imported.timers], [imported.timers]);

  const [range, setRange] = useState({ from: '2026-05-11', to: '2026-07-05' });

  const propById = useMemo(() => Object.fromEntries(seed.properties.map((p) => [p.id, p])), []);
  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t])), [techs]);

  const timers = useMemo(
    () => allTimers.filter((t) => t.date >= range.from && t.date <= range.to),
    [allTimers, range]
  );

  // commit parsed pay-log entries: resolve tech names to ids (reusing seed
  // techs on a name match), then widen the range so the data is visible
  const addImported = useCallback((rows) => {
    setImported((prev) => {
      const byName = new Map(prev.techs.map((t) => [t.name.toLowerCase(), t]));
      const newTechs = [...prev.techs];
      const base = prev.timers.length;
      const timers = rows.map((r, i) => {
        const nm = r.techName.trim();
        let tech = seed.techs.find((t) => t.name.toLowerCase() === nm.toLowerCase()) || byName.get(nm.toLowerCase());
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
      return { techs: newTechs, timers: [...prev.timers, ...timers] };
    });
    const dates = rows.map((r) => r.date);
    setRange((r) => ({
      from: dates.reduce((a, d) => (d < a ? d : a), r.from),
      to: dates.reduce((a, d) => (d > a ? d : a), r.to),
    }));
  }, []);

  const clearImported = useCallback(() => setImported({ timers: [], techs: [] }), []);

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
    const local = { ...p, receiptPath, id: 'pur_' + Math.random().toString(36).slice(2, 10), status: 'pending', createdAt: new Date().toISOString() };
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
  }, [purBackend]);

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

  return {
    meta: seed.meta,
    properties: seed.properties,
    techs,
    allTimers,
    timers,
    range, setRange,
    propById, techById,
    role,
    // import
    addImported, clearImported,
    hasImported: imported.timers.length > 0,
    importedCount: imported.timers.length,
    // work orders
    workOrders, addWorkOrder, setWoStatus, setWoPriority, woBackend,
    woNotice, clearWoNotice: () => setWoNotice(null),
    // cloud timers
    addTimerEntry, operatorId,
    // purchases
    purchases, addPurchase, setPurchaseStatus, purBackend,
    // documents
    documents, addDocument, docBackend,
  };
}
