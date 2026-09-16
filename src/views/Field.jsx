import { useState, useEffect, useRef, useMemo } from 'react';
import { fmtHrs } from '../lib/rollups.js';
import { categoryMedian } from '../lib/rollups.js';
import { categoryForText, tagSegments } from '../lib/taskTags.js';
import { WO_PRIORITIES, byPriority } from './WorkOrders.jsx';
import { getPosition, geofenceCheck, fmtDistance } from '../lib/geo.js';
import { todayISO, localISO } from '../lib/dates.js';
import { useVoiceCommands, speak } from '../lib/voice.js';
import VoiceCommandGuide from '../components/VoiceCommandGuide.jsx';
import { IcCoffee, IcUtensils, IcActivity, IcCheck, IcPlay, IcMapPin, IcMic, IcTrash } from '../components/ui.jsx';

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];

const tiInput = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 10, borderRadius: 10,
};

// contractor-friendly pacing: nudge a break after 3h straight, and around
// lunch. breaks pause the clock — break time never bills to the job.
const BREAK_AFTER_S = 3 * 3600;
const foodUrl = (p) =>
  'https://www.google.com/maps/search/' + encodeURIComponent(`food near ${p ? p.name + ' ' + (p.city || '') : 'me'}`);

// the running timer survives reloads/crashes: start timestamps live in
// localStorage, elapsed is recomputed from them, so the clock stays
// accurate even if the phone died mid-job.
const TIMER_KEY = 'caliper_field_timer_v1';
function loadTimer() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || {}; }
  catch { return {}; }
}

export default function Field({ store }) {
  const { pickProperties: properties = [], allTimers, workOrders, setWoStatus, fieldSync } = store;
  // the crew member IS the signed-in user — not a hardcoded demo tech. Rate is
  // matched from the roster by name when known (imported orgs carry rates);
  // otherwise 0 (the office holds the real rate server-side).
  const me = {
    id: store.myId || 'me',
    name: store.myName || 'You',
    rate: store.techs.find((t) => t.name && store.myName && t.name === store.myName)?.rate || 0,
  };
  const [running, setRunning] = useState(() => loadTimer().running ?? null); // {propId, unit, category, start, woId}
  const [elapsed, setElapsed] = useState(() => {
    const s = loadTimer();
    if (!s.running) return 0;
    const end = s.onBreak ? s.onBreak.start : Date.now();
    // baseMs = time already banked on this job from earlier sessions (paused → resumed)
    return Math.max(0, (end - s.running.start - (s.breakMs || 0) + (s.running.baseMs || 0)) / 1000);
  });
  // jobs parked mid-work (a priority call came in, or it spans days) — kept with
  // their banked time so they can be resumed later, even after a reload.
  const [paused, setPaused] = useState(() => loadTimer().paused ?? []);
  // always-fresh mirror of the parked-jobs list, so a mutation reads the latest
  // array synchronously even if it fires from a stale render closure.
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const [prop, setProp] = useState(properties[0]?.id || '');
  const [unit, setUnit] = useState('');
  const [cat, setCat] = useState('plumbing');
  const [task, setTask] = useState('');   // free-text note; #tags auto-set the category
  // typing a recognized #tag ("#mopping") jumps the category to its bucket
  const onTaskChange = (v) => { setTask(v); const c = categoryForText(v); if (c) setCat(c); };
  // "logged this session" persists across reloads, but prune to the last week
  // (and cap the size) so it doesn't show stale jobs or grow unbounded on-device.
  const [log, setLog] = useState(() => {
    const l = loadTimer().log ?? [];
    const wk = Date.now() - 7 * 86400000;
    return l.filter((e) => !e.at || e.at >= wk).slice(0, 60);
  });
  const tick = useRef();

  // verified clock-in: where the punch happened + whether it landed inside the
  // building's fence. Captured once at clock-in (that's when you're on site),
  // held on the running session, and stamped onto the logged entry on stop.
  const [punch, setPunch] = useState(() => loadTimer().punch ?? null); // { lat, lng, verified, distance }
  const [locating, setLocating] = useState(false);
  const punchTokenRef = useRef(0);
  const capturePunch = async (selected) => {
    const token = ++punchTokenRef.current; // supersede any in-flight capture
    setPunch(null); setLocating(true);
    const pos = await getPosition();
    if (punchTokenRef.current !== token) return; // a newer clock-in already ran — ignore this stale result
    setLocating(false);
    if (!pos) { setPunch({ verified: null, distance: null, denied: true }); return; }
    const fence = selected && selected.lat != null
      ? geofenceCheck({ lat: selected.lat, lng: selected.lng }, pos, selected.geofence)
      : { verified: null, distance: null };
    setPunch({ lat: pos.lat, lng: pos.lng, verified: fence.verified, distance: fence.distance });
  };

  // hands-free voice — gloves on, up a ladder: say "Caliper, start job".
  const [handsFree, setHandsFree] = useState(() => localStorage.getItem('caliper_handsfree') === '1');
  const [showCmds, setShowCmds] = useState(false);
  useEffect(() => { localStorage.setItem('caliper_handsfree', handsFree ? '1' : '0'); }, [handsFree]);

  // break machinery: while on break the work clock freezes
  const [onBreak, setOnBreak] = useState(() => loadTimer().onBreak ?? null); // { start }
  const [breakMs, setBreakMs] = useState(() => loadTimer().breakMs ?? 0);
  const [breakNow, setBreakNow] = useState(0);    // live seconds of current break
  const [lastNudge, setLastNudge] = useState(() => loadTimer().lastNudge ?? 0); // work-seconds when last nudged
  const [lunchNudged, setLunchNudged] = useState(() => loadTimer().lunchNudged ?? false);

  // persist everything the clock needs to reconstruct itself. updatedAt stamps the
  // local cache so cross-device sync can tell whose copy is newer on reload.
  useEffect(() => {
    localStorage.setItem(TIMER_KEY, JSON.stringify({ running, log, onBreak, breakMs, lastNudge, lunchNudged, punch, paused, updatedAt: Date.now() }));
  }, [running, log, onBreak, breakMs, lastNudge, lunchNudged, punch, paused]);

  // write the timer snapshot to localStorage SYNCHRONOUSLY. The reactive effect
  // above also persists, but it flushes after paint — on mobile the tab can be
  // suspended or reloaded in that gap, dropping a just-parked job. Parked jobs
  // carry banked labor, so persist the instant they change. `over` supplies the
  // new values (the closure's state is still the pre-update value).
  const writeTimerNow = (over) => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify({
        running, log, onBreak, breakMs, lastNudge, lunchNudged, punch,
        paused: pausedRef.current, updatedAt: Date.now(), ...over,   // freshest parked list unless overridden
      }));
    } catch { /* quota/serialization — the reactive effect will retry */ }
  };

  // broadcast live presence so the office board sees this timer tick in real time
  useEffect(() => {
    if (!running) { store.syncLivePresence(null); return; }
    const p = properties.find((x) => x.id === running.propId);
    store.syncLivePresence({
      startedAt: new Date(running.start).toISOString(),
      workOrderId: /^[0-9a-f-]{36}$/i.test(String(running.woId)) ? running.woId : null,
      task: running.woTask || null, propLabel: p?.name || null, unit: running.unit, onBreak: !!onBreak,
    });
  }, [running, onBreak]);

  // ---- cross-device mirror: the device you're actively using OWNS the timer and
  // publishes its running + parked state to one cloud row; the other devices you're
  // signed into (and the office) SHOW it read-only. This is deliberately NOT
  // interactive on the mirror side: a second device must never stop/resume the same
  // session — that would double-log hours or lose banked time. localStorage stays
  // the offline working copy; the cloud only reflects it. Single writer, no adopt,
  // so there's no merge conflict, echo loop, or double-log to reason about.
  const wasWriterRef = useRef(false);
  const hasLocalTimer = !!running || (Array.isArray(paused) && paused.length > 0);
  // publish local state (debounced). Only a device that has (or has had, this
  // session) a local timer writes — an idle device never clobbers the owner's row.
  useEffect(() => {
    if (!fieldSync) return undefined;
    if (hasLocalTimer) wasWriterRef.current = true;
    if (!wasWriterRef.current) return undefined;
    const id = setTimeout(() => {
      fieldSync.push({ running, paused: pausedRef.current, onBreak, breakMs, lastNudge, lunchNudged, punch });
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, paused, onBreak, breakMs, lastNudge, lunchNudged, punch, fieldSync]);

  // read this operator's cloud row (their active device's state) for the mirror
  const [myCloud, setMyCloud] = useState(null);
  useEffect(() => {
    if (!fieldSync) { setMyCloud(null); return undefined; }
    let alive = true;
    fieldSync.load().then((c) => { if (alive) setMyCloud(c?.state || null); });
    const unsub = fieldSync.subscribe((s) => { if (alive) setMyCloud(s || null); });
    return () => { alive = false; if (typeof unsub === 'function') unsub(); };
  }, [fieldSync]);

  // show the mirror only when THIS device is idle (no local running or parked job)
  // and the cloud has something — i.e. you're clocked in / parked on another device.
  const mirror = useMemo(() => {
    if (running || (Array.isArray(paused) && paused.length > 0) || !myCloud) return null;
    const has = myCloud.running || (Array.isArray(myCloud.paused) && myCloud.paused.length > 0);
    return has ? myCloud : null;
  }, [running, paused, myCloud]);
  const [mirrorNow, setMirrorNow] = useState(() => Date.now());
  useEffect(() => {
    if (!mirror) return undefined;
    const id = setInterval(() => setMirrorNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mirror]);

  const myWos = workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress').sort(byPriority);

  // start the timer straight from a work order — property/unit/category prefilled
  const startFromWo = (w) => {
    const p = properties.find((x) => x.name === w.propLabel);
    setWoStatus(w.id, 'in_progress');
    const newRunning = {
      propId: p?.id || properties[0]?.id || '', unit: w.unit || '—',
      category: w.category || 'general', start: Date.now(), woId: w.id, woTask: w.task, rate: me.rate, baseMs: 0,
    };
    setRunning(newRunning);
    setElapsed(0); resetBreaks();
    writeTimerNow({ running: newRunning, onBreak: null, breakMs: 0, lastNudge: 0, lunchNudged: false, punch: null });
    capturePunch(p || properties[0]);
  };

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        const end = onBreak ? onBreak.start : Date.now();
        setElapsed(Math.max(0, (end - running.start - breakMs + (running.baseMs || 0)) / 1000));
        if (onBreak) setBreakNow((Date.now() - onBreak.start) / 1000);
      }, 250);
      return () => clearInterval(tick.current);
    }
  }, [running, onBreak, breakMs]);

  const startBreak = () => { setOnBreak({ start: Date.now() }); setBreakNow(0); };
  const endBreak = () => { if (!onBreak) return; setBreakMs((b) => b + (Date.now() - onBreak.start)); setOnBreak(null); setLastNudge(elapsed); };

  const hour = new Date().getHours();
  const lunchTime = hour >= 11 && hour < 14;
  // Settings → "Break reminders" / "Lunch nudge" switch these off
  const prefs = store.notifPrefs || {};
  const nudge = running && !onBreak && (
    prefs.breaks !== false && elapsed - lastNudge >= BREAK_AFTER_S ? 'stretch'
    : (prefs.lunch !== false && lunchTime && elapsed > 3600 && !lunchNudged ? 'lunch' : null)
  );

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  const resetBreaks = () => { setOnBreak(null); setBreakMs(0); setBreakNow(0); setLastNudge(0); setLunchNudged(false); };
  const start = () => {
    const selected = properties.find((x) => x.id === prop);
    const newRunning = { propId: prop, unit: unit || '—', category: cat, start: Date.now(), rate: me.rate, woTask: task.trim() || null, baseMs: 0 };
    setRunning(newRunning);
    setElapsed(0); resetBreaks(); setTask('');
    writeTimerNow({ running: newRunning, onBreak: null, breakMs: 0, lastNudge: 0, lunchNudged: false, punch: null });
    capturePunch(selected);
  };
  // park the running job with its banked time so a priority call (or a multi-day
  // job) can be picked back up later — even after a reload. One job runs at a time.
  const pauseJob = () => {
    if (!running) return;
    punchTokenRef.current++;
    const end = onBreak ? onBreak.start : Date.now();
    const banked = Math.max(0, end - running.start - breakMs + (running.baseMs || 0));
    const p = properties.find((x) => x.id === running.propId);
    const job = {
      id: 'pj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      propId: running.propId, unit: running.unit, category: running.category,
      woId: running.woId || null, woTask: running.woTask || null, rate: running.rate || 0,
      baseMs: banked, propName: p?.name || 'Unassigned', at: Date.now(),
    };
    // prepend to the FRESH list (ref, not the render closure) so parking a second
    // job never drops the first, and persist it synchronously so a reload can't.
    const next = [job, ...pausedRef.current];
    pausedRef.current = next;
    setPaused(next);
    setRunning(null); setElapsed(0); resetBreaks(); setPunch(null);
    writeTimerNow({ paused: next, running: null, onBreak: null, breakMs: 0, lastNudge: 0, lunchNudged: false, punch: null });
  };
  // pick a parked job back up — its banked time carries over, the clock continues.
  const resumeJob = (pj) => {
    if (running) return;                 // finish or pause the current job first
    const selected = properties.find((x) => x.id === pj.propId);
    const newRunning = { propId: pj.propId, unit: pj.unit, category: pj.category, start: Date.now(), rate: pj.rate || me.rate, woId: pj.woId || null, woTask: pj.woTask || null, baseMs: pj.baseMs || 0 };
    const next = pausedRef.current.filter((x) => x.id !== pj.id);
    pausedRef.current = next;
    setRunning(newRunning);
    setElapsed((pj.baseMs || 0) / 1000); resetBreaks();
    setPaused(next);
    // persist synchronously: the job is now live, no longer parked — a crash here
    // must not leave it BOTH running and parked (a double-count on next reload).
    writeTimerNow({ running: newRunning, paused: next, onBreak: null, breakMs: 0, lastNudge: 0, lunchNudged: false });
    capturePunch(selected);
  };
  const discardPaused = (id) => {
    const next = pausedRef.current.filter((x) => x.id !== id);
    pausedRef.current = next;
    setPaused(next);
    writeTimerNow({ paused: next });
  };
  const stop = async () => {
    if (!running) return;             // guard a double-tap from logging the job twice
    punchTokenRef.current++;          // invalidate any GPS capture still in flight
    const hrs = Math.round(Math.max(0.05, elapsed / 3600) * 100) / 100;
    const p = properties.find((x) => x.id === running.propId);
    const pName = p?.name || 'Unassigned';
    const punchAtStop = punch;
    const entryId = Date.now();
    const newLog = [{ id: entryId, at: entryId, prop: pName, unit: running.unit, category: running.category, hrs, cost: hrs * me.rate, verified: punchAtStop?.verified ?? null, distance: punchAtStop?.distance ?? null, sync: 'saving' }, ...log];
    setLog(newLog);
    setRunning(null); setElapsed(0); resetBreaks(); setPunch(null);
    // persist the cleared running + the logged entry synchronously, so a reload
    // right after stopping can't resurrect the running job and log it twice.
    writeTimerNow({ running: null, onBreak: null, breakMs: 0, lastNudge: 0, lunchNudged: false, punch: null, log: newLog });
    // land the hours in the cloud so management sees them — queued if offline.
    // The verified punch rides along so the office/owner P&L sees on-site labor.
    const res = await store.addTimerEntry({
      propLabel: pName, unit: running.unit === '—' ? null : running.unit,
      date: todayISO(), category: running.category,
      durationHrs: hrs, note: running.woTask || null, workOrderId: running.woId || null,
      issue: running.woTask || null,
      gpsLat: punchAtStop?.lat ?? null, gpsLng: punchAtStop?.lng ?? null,
      verified: punchAtStop?.verified ?? null, distanceM: punchAtStop?.distance ?? null,
    });
    setLog((l) => l.map((e) => (e.id === entryId ? { ...e, sync: res.status, dbId: res.id, note: running.woTask || null } : e)));
  };

  // route a recognized voice intent to the timer, with an audible confirmation.
  // a fuzzy (mis-heard) destructive command waits for a yes/no before firing
  const [pendingVoice, setPendingVoice] = useState(null); // { intent }
  const pendingTimerRef = useRef(null);
  const clearPending = () => { setPendingVoice(null); if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); };
  const armPending = (intent) => {
    setPendingVoice({ intent });
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => setPendingVoice(null), 12000);
  };
  useEffect(() => () => { if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); }, []);

  // voice dispatch with a confirmation gate: an exact command runs immediately,
  // but a fuzzy match on a destructive action (stop/done) asks first, so a noisy
  // mis-hear ("stock job") can't silently stop a timer.
  const handleVoice = (intent, cmd) => {
    if (pendingVoice) {
      if (intent === 'confirm') { const p = pendingVoice.intent; clearPending(); runIntent(p); return; }
      if (intent === 'cancel') { clearPending(); speak('Okay, cancelled.'); return; }
      clearPending(); // any other real command supersedes the pending one
    }
    if (intent === 'confirm' || intent === 'cancel') return; // nothing to confirm
    if (cmd?.confirm) {
      const LABEL = { start: 'start the job', stop: 'stop the job', done: 'mark it done', pauseJob: 'pause and switch jobs', break: 'take a break', resume: 'get back to work' };
      armPending(intent);
      speak(`Heard ${LABEL[intent] || intent}. Say Caliper yes to confirm, or Caliper no.`);
      return;
    }
    runIntent(intent);
  };

  // Recreated every render so it always reads current running/break/elapsed.
  const runIntent = (intent) => {
    const propName = () => properties.find((p) => p.id === (running ? running.propId : prop))?.name || 'the job';
    if (intent === 'start') {
      if (running) { speak('Already on the clock.'); return; }
      start(); speak(`Started ${propName()}.`);
    } else if (intent === 'stop') {
      if (!running) { speak('No timer running.'); return; }
      speak('Stopped and logged.'); stop();
    } else if (intent === 'done') {
      if (!running) { speak('No timer running.'); return; }
      if (running.woId) setWoStatus(running.woId, 'done');
      speak('Marked done and logged.'); stop();
    } else if (intent === 'pauseJob') {
      if (!running) { speak('No job to pause.'); return; }
      const nm = propName();               // capture before pauseJob clears `running`
      pauseJob(); speak(`Parked ${nm}. Pick it back up any time.`);
    } else if (intent === 'break') {
      if (!running) { speak('Start a job first.'); return; }
      if (onBreak) { speak('Already on break.'); return; }
      startBreak(); speak('On break. The clock is paused.');
    } else if (intent === 'resume') {
      if (!onBreak) { speak('You are not on break.'); return; }
      endBreak(); speak('Back to work.');
    } else if (intent === 'status') {
      if (!running) { speak('No timer running.'); return; }
      const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60);
      const parts = [];
      if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
      parts.push(`${m} minute${m === 1 ? '' : 's'}`);
      speak(`${parts.join(' and ')} on ${propName()}${onBreak ? ', on break' : ''}.`);
    }
  };
  const voice = useVoiceCommands({ enabled: handsFree, onCommand: handleVoice, context: { running: !!running, onBreak: !!onBreak } });

  // ---- edit a logged entry: fix property / unit / category / hours ----
  const [editing, setEditing] = useState(null); // { id, prop, unit, category, hrs, note }
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // log entry id awaiting delete confirm
  const delEntry = async (l) => {
    setConfirmDel(null);
    const res = await store.deleteTimerEntry(l);   // drops the cloud row and/or the queued payload
    if (res && res.ok === false) return;           // cloud delete failed — keep the row so it isn't silently lost
    setLog((prev) => prev.filter((x) => x.id !== l.id));
    store.audit && store.audit('delete_timer', `${l.prop} ${l.unit} · ${l.hrs}h`);
  };
  const beginEdit = (l) => {
    const pid = properties.find((p) => p.name === l.prop)?.id || properties[0]?.id || '';
    setEditing({ id: l.id, prop: pid, unit: l.unit === '—' ? '' : (l.unit || ''), category: l.category, hrs: String(l.hrs), note: l.note || '' });
  };
  const saveEdit = async () => {
    const e = editing; if (!e) return;
    setEditBusy(true);
    const pName = properties.find((p) => p.id === e.prop)?.name || 'Unassigned';
    const hrs = Math.round(Math.max(0.05, parseFloat(e.hrs) || 0) * 100) / 100;
    const unit = e.unit.trim() || '—';
    const entry = log.find((x) => x.id === e.id);
    const res = await store.updateTimerEntry(entry, {
      propLabel: pName, unit, date: localISO(new Date(entry.at || Date.now())),
      category: e.category, durationHrs: hrs, note: e.note.trim() || null,
    });
    setLog((l) => l.map((x) => (x.id === e.id
      ? { ...x, prop: pName, unit, category: e.category, hrs, cost: hrs * me.rate, note: e.note.trim() || null, sync: res.status, dbId: res.id || x.dbId }
      : x)));
    store.audit && store.audit('edit_timer', `${pName} ${unit} · ${hrs}h`);
    setEditBusy(false); setEditing(null);
  };

  // live "on-site / off-site" chip from the clock-in punch
  const selectedProp = properties.find((p) => p.id === (running ? running.propId : prop));
  const hasFence = selectedProp && selectedProp.lat != null;
  const punchChip = (() => {
    if (locating) return { txt: 'Locating…', color: 'var(--text-dim)', bg: 'var(--surface-2)', bd: 'var(--line)' };
    if (!punch) return null;
    if (punch.verified === true) return { txt: `On-site · ${fmtDistance(punch.distance)}`, color: 'var(--money)', bg: '#4ade8012', bd: '#4ade8033', on: true };
    if (punch.verified === false) return { txt: `Off-site · ${fmtDistance(punch.distance)} from ${selectedProp?.name || 'site'}`, color: 'var(--warn)', bg: '#f59e0b12', bd: '#f59e0b33' };
    if (punch.denied) return { txt: 'Location off — punch not verified', color: 'var(--text-faint)', bg: 'var(--surface-2)', bd: 'var(--line)' };
    return { txt: 'Logged — no fence set for this building', color: 'var(--text-faint)', bg: 'var(--surface-2)', bd: 'var(--line)' };
  })();
  const PunchChip = () => punchChip && (
    <div className="offline" style={{ textAlign: 'left', color: punchChip.color, borderColor: punchChip.bd, background: punchChip.bg, marginBottom: 12 }}>
      {punchChip.on ? <IcCheck width={15} height={15} /> : <IcMapPin width={15} height={15} />}
      <span style={{ marginLeft: 2, fontWeight: 700 }}>{punchChip.txt}</span>
    </div>
  );

  const median = categoryMedian(allTimers, cat);

  // my pay period: hours + earnings logged since the pay week started (Saturday)
  const weekStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() - 6 + 7) % 7)); return d.getTime(); })();
  const period = log.filter((e) => !e.at || e.at >= weekStart);
  const periodHrs = Math.round(period.reduce((a, e) => a + (e.hrs || 0), 0) * 10) / 10;
  const periodPay = period.reduce((a, e) => a + (e.cost || 0), 0);

  return (
    <div>
      <div className="view-head">
        <h1>Field</h1>
        <p>{me.name}{me.rate > 0 ? ` · $${me.rate}/hr` : ''} · one timer per job</p>
      </div>

      {/* my pay period — transparency, no more "PAID BY BRENT" guessing */}
      <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="field-label" style={{ margin: 0 }}>This pay period · since Saturday</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--money)' }}>${periodPay.toFixed(2)}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>{periodHrs} hrs · {period.length} jobs</span>
          </div>
        </div>
      </div>

      {/* this login's timer running/parked on ANOTHER device — mirror it live so
          the desktop/other tab isn't blank while the phone owns the clock. Read
          only: you stop or resume on the device that owns it, so hours can't
          double-log and banked time can't be lost. */}
      {mirror && (() => {
        const r = mirror.running;
        const runProp = r ? (properties.find((x) => x.id === r.propId)?.name || r.propLabel || 'Unassigned') : null;
        let clock = null;
        if (r) {
          const secs = Math.max(0, (mirrorNow - r.start - (mirror.breakMs || 0) + (r.baseMs || 0)) / 1000);
          clock = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
        }
        const parked = Array.isArray(mirror.paused) ? mirror.paused : [];
        return (
          <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--warn)', fontWeight: 800, fontSize: 12, letterSpacing: '.02em' }}>
              <IcPlay width={13} height={13} /> ON ANOTHER DEVICE
              {mirror.onBreak && r ? <span className="chip" style={{ marginLeft: 8, color: 'var(--warn)' }}>on break</span> : null}
            </span>
            {r && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{clock}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>{[runProp, r.unit && r.unit !== '—' ? `Unit ${r.unit}` : null, r.woTask].filter(Boolean).join(' · ')}</span>
              </div>
            )}
            {parked.length > 0 && (
              <div style={{ marginTop: r ? 10 : 6 }}>
                <div className="field-label" style={{ margin: '0 0 4px' }}>Parked jobs ({parked.length})</div>
                {parked.map((pj, i) => (
                  <div key={pj.id || i} className="s" style={{ color: 'var(--text-dim)', padding: '2px 0' }}>
                    {pj.propName || 'Unassigned'}{pj.unit && pj.unit !== '—' ? ` · ${pj.unit}` : ''} · <b>{Math.round(((pj.baseMs || 0) / 3600000) * 10) / 10}h banked</b>
                  </div>
                ))}
              </div>
            )}
            <p className="note" style={{ margin: '8px 0 0' }}>
              {r ? 'You’re on the clock on another device. ' : 'You have parked jobs on another device. '}
              Stop or resume them on that device — this view mirrors it live so nothing double-logs.
            </p>
          </div>
        );
      })()}

      <div className="offline">◐ Offline-safe — timers and photos queue on-device, sync when signal returns.</div>

      {/* hands-free voice — say "Caliper, start job" without touching the phone */}
      <div className="card voice-card" style={{ marginBottom: 'var(--gap)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={'btn voice-toggle' + (handsFree ? ' on' : ' ghost')}
            onClick={() => { const n = !handsFree; setHandsFree(n); if (n) speak('Hands-free on.'); }}
            disabled={!voice.supported}
            aria-pressed={handsFree}
            style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, width: 'auto', padding: '10px 14px' }}
          >
            <span className={'voice-mic' + (handsFree && voice.listening ? ' pulse' : '')} style={{ display: 'inline-flex' }}><IcMic width={17} height={17} /></span>
            {handsFree ? 'Hands-free on' : 'Hands-free'}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost sm" style={{ flex: 'none' }} onClick={() => setShowCmds((v) => !v)}>{showCmds ? 'Hide' : 'Commands'}</button>
        </div>
        <div style={{ marginTop: 8 }}>
          {!voice.supported ? (
            <div className="s" style={{ color: 'var(--text-dim)' }}>Voice needs Chrome, Edge, or Android. Tap-free once supported.</div>
          ) : voice.error ? (
            <div className="s" style={{ color: 'var(--danger)' }}>{voice.error}</div>
          ) : pendingVoice ? (
            <div className="s" style={{ color: 'var(--warn)', fontWeight: 600 }}>
              Did you mean “<b>{{ start: 'start the job', stop: 'stop the job', done: 'mark it done', break: 'take a break', resume: 'back to work' }[pendingVoice.intent] || pendingVoice.intent}</b>”? Say “<b>Caliper, yes</b>” to confirm or “<b>Caliper, no</b>”.
              {voice.lastHeard && <div style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)', fontSize: 11, marginTop: 2 }}>heard: “{voice.lastHeard}”</div>}
            </div>
          ) : handsFree ? (
            <div className="s" style={{ color: voice.listening ? 'var(--money)' : 'var(--text-dim)' }}>
              {voice.listening ? 'Listening — ' : 'Starting… '}say “<b>Caliper, {running ? (onBreak ? 'back to work' : 'stop job') : 'start job'}</b>”
              {voice.lastHeard && <div style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)', fontSize: 11, marginTop: 2 }}>heard: “{voice.lastHeard}”</div>}
            </div>
          ) : (
            <div className="s" style={{ color: 'var(--text-dim)' }}>Turn on to run the timer by voice — start, stop, break, all hands-free.</div>
          )}
        </div>
        {showCmds && <div style={{ marginTop: 12 }}><VoiceCommandGuide compact /></div>}
      </div>

      {!running && myWos.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Work orders ({myWos.length})</span>
          {myWos.map((w) => (
            <div className="row" key={w.id}>
              <div className="lead">
                <div className="t"><span style={{ color: WO_PRIORITIES[w.priority ?? 3].color, marginRight: 6 }}>●</span>{w.task}</div>
                <div className="s">{[WO_PRIORITIES[w.priority ?? 3].label, w.propLabel, w.unit && `Unit ${w.unit}`, w.category, w.due && `due ${w.due}`].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn ghost sm" onClick={() => startFromWo(w)}><IcPlay width={13} height={13} /> Start</button>
            </div>
          ))}
        </div>
      )}

      {running && onBreak ? (
        <div className="timer-live" style={{ borderColor: '#4ade8044' }}>
          <div style={{ color: 'var(--money)', display: 'flex', justifyContent: 'center', marginBottom: 4 }}><IcCoffee width={30} height={30} /></div>
          <div className="clock mono" style={{ color: 'var(--money)' }}>
            {String(Math.floor(breakNow / 60)).padStart(2, '0')}:{String(Math.floor(breakNow % 60)).padStart(2, '0')}
          </div>
          <div className="meta">On break — the job clock is paused at {hh}:{mm}:{ss}. Break time never bills.</div>
          <div style={{ height: 14 }} />
          <a className="btn ghost" style={{ marginBottom: 10, textDecoration: 'none' }}
            href={foodUrl(properties.find((p) => p.id === running.propId))} target="_blank" rel="noreferrer">
            <IcUtensils width={16} height={16} /> Food near the job site
          </a>
          <button className="btn grad" onClick={endBreak}><IcPlay width={15} height={15} /> Back to work</button>
        </div>
      ) : running ? (
        <div className="timer-live">
          {nudge && (
            <div className="offline" style={{ textAlign: 'left', color: 'var(--money)', borderColor: '#4ade8033', background: '#4ade8012' }}>
              {nudge === 'lunch' ? <IcUtensils width={16} height={16} /> : <IcActivity width={16} height={16} />}
              <span style={{ marginLeft: 2 }}>{nudge === 'lunch' ? 'Lunchtime — grab a bite?' : `${Math.floor(elapsed / 3600)}h straight — stretch those legs?`}</span>
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={startBreak}>Break</button>
              <button className="btn ghost sm" style={{ color: 'var(--text-faint)' }}
                onClick={() => { setLastNudge(elapsed); if (nudge === 'lunch') setLunchNudged(true); }}>Later</button>
            </div>
          )}
          <PunchChip />
          <div className="clock grad-text settle">{hh}:{mm}:{ss}</div>
          <div className="meta">
            {running.woTask ? `${running.woTask} · ` : ''}{properties.find((p) => p.id === running.propId)?.name} · Unit {running.unit} · {running.category}
            {breakMs > 0 && <> · {Math.round(breakMs / 60000)}m of breaks (unbilled)</>}
          </div>
          <div style={{ height: 18 }} />
          <button className="btn stop" onClick={stop}>Stop &amp; log to this job</button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={pauseJob}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            Pause — switch to another job
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={startBreak}><IcCoffee width={16} height={16} /> Take a break</button>
          {running.woId && (
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setWoStatus(running.woId, 'done'); stop(); }}>
              <IcCheck width={15} height={15} /> Stop &amp; mark work order done
            </button>
          )}
        </div>
      ) : (
        <>
        {paused.length > 0 && (
          <div className="card" style={{ marginBottom: 'var(--gap)' }}>
            <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              Paused jobs — pick one back up
            </div>
            {paused.map((pj) => (
              <div className="row" key={pj.id} style={{ alignItems: 'center' }}>
                <div className="lead">
                  <div className="t">{pj.propName}{pj.unit && pj.unit !== '—' ? ` · ${pj.unit}` : ''}</div>
                  <div className="s">{pj.woTask ? `${pj.woTask} · ` : ''}{pj.category} · <b>{fmtHrs((pj.baseMs || 0) / 3600000)}h banked</b></div>
                </div>
                <button className="btn grad sm" onClick={() => resumeJob(pj)}><IcPlay width={14} height={14} /> Resume</button>
                <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)', marginLeft: 6 }} onClick={() => discardPaused(pj.id)} aria-label="Discard paused job"><IcTrash width={13} height={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="card">
          <div className="field-label">Property</div>
          <select className="rangebar" value={prop} onChange={(e) => setProp(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontWeight: 700, fontSize: 14, padding: 12, borderRadius: 10, marginBottom: 16 }}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
          </select>
          <p className="note" style={{ margin: '-8px 2px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <IcMapPin width={12} height={12} style={{ color: hasFence ? 'var(--money)' : 'var(--text-faint)' }} />
            {hasFence ? 'Verified clock-in on — your punch is checked against this building.' : 'No location set for this building — punch logs without verification.'}
          </p>

          <div className="field-label">Unit</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B"
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: 12, borderRadius: 10, marginBottom: 16 }} />

          <div className="field-label">What are you on? <span style={{ color: 'var(--text-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— type <b style={{ color: 'var(--accent)' }}>#</b> to tag (#rounds, #mopping, #spotcheck…)</span></div>
          <input value={task} onChange={(e) => onTaskChange(e.target.value)} placeholder="e.g. #rounds + trash haul on the 2nd floor"
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 12, borderRadius: 10, marginBottom: task ? 8 : 16 }} />
          {task && tagSegments(task).some((s) => s.tag) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {tagSegments(task).filter((s) => s.tag).map((s, i) => (
                <span key={i} className="chip" style={{ borderColor: s.category ? 'var(--accent)' : 'var(--line)', color: s.category ? 'var(--accent)' : 'var(--text-dim)' }}>
                  #{s.tag}{s.category && <span style={{ color: 'var(--text-faint)', marginLeft: 5 }}>→ {s.category}</span>}
                </span>
              ))}
            </div>
          )}

          <div className="field-label">Category</div>
          <div className="pick" style={{ marginBottom: 8 }}>
            {CATS.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          <p className="note" style={{ marginTop: 4 }}>Typical {cat} job runs {fmtHrs(median)} hrs here — you'll see this job measured against that when you stop.</p>

          <div style={{ height: 16 }} />
          <button className="btn grad" onClick={start}><IcPlay width={16} height={16} /> Start timer</button>
        </div>
        </>
      )}

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">Logged this session</span>
          {log.map((l) => {
            if (editing && editing.id === l.id) {
              return (
                <div className="ti-edit" key={l.id}>
                  <div className="field-label" style={{ marginTop: 0 }}>Edit entry</div>
                  <div className="grid g2" style={{ gap: 8 }}>
                    <select style={tiInput} value={editing.prop} onChange={(e) => setEditing({ ...editing, prop: e.target.value })}>
                      {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input style={tiInput} value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="Unit (e.g. 4B)" />
                  </div>
                  <div className="pick" style={{ margin: '8px 0' }}>
                    {CATS.map((c) => <button key={c} className={editing.category === c ? 'on' : ''} onClick={() => setEditing({ ...editing, category: c })}>{c}</button>)}
                  </div>
                  <div className="grid g2" style={{ gap: 8 }}>
                    <div>
                      <div className="field-label" style={{ marginTop: 0 }}>Hours</div>
                      <input style={tiInput} type="number" step="0.05" min="0.05" inputMode="decimal" value={editing.hrs} onChange={(e) => setEditing({ ...editing, hrs: e.target.value })} />
                    </div>
                    <div>
                      <div className="field-label" style={{ marginTop: 0 }}>Note</div>
                      <input style={tiInput} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="what you did" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn ghost" style={{ flex: 1 }} onClick={() => setEditing(null)} disabled={editBusy}>Cancel</button>
                    <button className="btn grad" style={{ flex: 2 }} onClick={saveEdit} disabled={editBusy || !(parseFloat(editing.hrs) > 0)}>{editBusy ? 'Saving…' : 'Save & resubmit'}</button>
                  </div>
                </div>
              );
            }
            const med = categoryMedian(allTimers, l.category);
            const delta = med ? l.hrs - med : 0;
            return (
              <div className="row" key={l.id}>
                <div className="lead">
                  <div className="t">{l.prop} · {l.unit}
                    {l.verified === true && <span title={`On-site · ${fmtDistance(l.distance)}`} style={{ marginLeft: 6, color: 'var(--money)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 2 }}><IcCheck width={11} height={11} /> on-site</span>}
                    {l.verified === false && <span title={`Off-site · ${fmtDistance(l.distance)}`} style={{ marginLeft: 6, color: 'var(--warn)', fontSize: 11, fontWeight: 700 }}>off-site</span>}
                  </div>
                  <div className="s">{l.category}
                    {med > 0 && <> · {delta > 0.15 ? <span style={{ color: 'var(--warn)' }}>{fmtHrs(delta)}h over normal</span> : delta < -0.15 ? <span className="money">{fmtHrs(-delta)}h under</span> : 'on pace'}</>}
                  </div>
                </div>
                <div className="val">
                  <div className="big">{fmtHrs(l.hrs)}h</div>
                  <div className="small money">${l.cost.toFixed(2)}</div>
                  {l.sync && <div className="small" style={{ color: l.sync === 'synced' ? 'var(--money)' : 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                    {l.sync === 'synced' ? <><IcCheck width={11} height={11} /> synced</> : l.sync === 'queued' ? 'syncs when online' : l.sync === 'saving' ? 'saving…' : 'this device'}
                  </div>}
                </div>
                {l.sync !== 'saving' && (confirmDel === l.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => delEntry(l)}>Delete</button>
                    <button className="btn ghost sm" onClick={() => setConfirmDel(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button className="btn ghost sm ti-edit-btn" onClick={() => beginEdit(l)}>Edit</button>
                    <button className="btn ghost sm" style={{ color: 'var(--text-faint)', padding: '4px 8px' }} onClick={() => setConfirmDel(l.id)} aria-label="Delete entry"><IcTrash width={13} height={13} /></button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
