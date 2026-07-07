import { useMemo, useState, useEffect, useCallback } from 'react';
import seed from '../data/seed.json';
import { useAuth } from '../components/AuthGate.jsx';
import {
  isConfigured, listWorkOrders, insertWorkOrder, updateWorkOrderStatus,
  listPurchases, insertPurchase, setPurchaseStatus as dbSetPurchaseStatus, uploadReceipt,
  listDocuments, uploadDocument,
} from './backend/supabase.js';

const IMP_KEY = 'caliper_imported_v1';
const WO_KEY = 'caliper_workorders_v1';
const PUR_KEY = 'caliper_purchases_v1';

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
    workOrders, addWorkOrder, setWoStatus, woBackend,
    // purchases
    purchases, addPurchase, setPurchaseStatus, purBackend,
    // documents
    documents, addDocument, docBackend,
  };
}
