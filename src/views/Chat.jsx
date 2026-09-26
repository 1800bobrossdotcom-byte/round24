import { useState, useRef, useEffect, useMemo } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';
import { IcMic, IcSend, IcX, IcSparkle, IcCheck, IcClip, IcTrash } from '../components/ui.jsx';
import StoredImage from '../components/StoredImage.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { FileChip } from '../components/FileChip.jsx';

// Slack-style team comms: office↔crew and crew↔crew. Typed notes and voice
// notes, live over realtime. Per-work-order threads turn a job into a running
// log, and office can summarize a thread into a work-order update with AI.
const inputStyle = {
  flex: 1, minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: '11px 12px', borderRadius: 4,
};

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const fmtSecs = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

export default function Chat({ store }) {
  const { messages, addMessage, deleteMessage, msgBackend, workOrders, summarizeMessages, myId, myName, role,
    roster, privateChannels, addChannel } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [delId, setDelId] = useState(null);   // message pending unsend confirm

  const channels = useMemo(() => {
    const wos = workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress');
    const priv = (privateChannels || []).map((c) => ({
      id: c.id, kind: c.kind,
      label: c.kind === 'dm' ? (c.memberLabels.find((l) => l !== myName) || 'Direct') : (c.name || 'Group'),
    }));
    return [
      { id: 'all', label: '# Team' },
      ...priv,
      ...wos.map((w) => ({ id: 'wo:' + w.id, label: w.task.slice(0, 22), wo: w })),
    ];
  }, [workOrders, privateChannels, myName]);
  const [channel, setChannel] = useState('all');
  const [picker, setPicker] = useState(false);
  const activeCh = channels.find((c) => c.id === channel);
  const activeWo = activeCh?.wo || null;
  const isWoChannel = channel.startsWith('wo:');
  const target = channel === 'all' ? 'the team' : isWoChannel ? 'the crew on this job'
    : activeCh?.kind === 'dm' ? activeCh.label : (activeCh?.label || 'the group');

  const thread = useMemo(() => messages.filter((m) => (m.channel || 'all') === channel), [messages, channel]);

  const [text, setText] = useState('');
  const [attachFile, setAttachFile] = useState(null);
  const isImgAttach = attachFile && (attachFile.type || '').startsWith('image/');
  const imgPreview = useMemo(() => (attachFile && (attachFile.type || '').startsWith('image/') ? URL.createObjectURL(attachFile) : null), [attachFile]);
  useEffect(() => () => { if (imgPreview) URL.revokeObjectURL(imgPreview); }, [imgPreview]);
  const [lb, setLb] = useState(null); // lightbox image descriptor
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summErr, setSummErr] = useState(null);
  const [summBusy, setSummBusy] = useState(false);
  const scroller = useRef(null);

  // recording state
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [recErr, setRecErr] = useState(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const tickRef = useRef(null);
  const secsRef = useRef(0);   // authoritative elapsed seconds — onstop's closure over recSecs is stale
  const streamRef = useRef(null);
  // if the user leaves the tab mid-recording, onstop never fires — stop the mic + interval so the
  // hardware indicator turns off and we don't setState on an unmounted component
  useEffect(() => () => { clearInterval(tickRef.current); streamRef.current?.getTracks?.().forEach((t) => t.stop()); }, []);

  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [thread.length, channel]);

  const send = async (voiceBlob, voiceSecs) => {
    if (!voiceBlob && !text.trim() && !attachFile) return;
    setBusy(true);
    try {
      await addMessage({ channel, body: text, voiceBlob, voiceSecs, attachFile, workOrderId: activeWo?.id });
      setText(''); setAttachFile(null);
    } finally { setBusy(false); }
  };

  const startRec = async () => {
    setRecErr(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setRecErr('Voice notes need mic access (Chrome/Safari).'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recRef.current = rec; chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        clearInterval(tickRef.current);
        const secs = secsRef.current;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setRecording(false); setRecSecs(0);
        if (blob.size > 0) send(blob, secs);
      };
      rec.start();
      setRecording(true); setRecSecs(0); secsRef.current = 0;
      tickRef.current = setInterval(() => { secsRef.current += 1; setRecSecs((s) => s + 1); }, 1000);
    } catch { setRecErr('Microphone permission denied.'); }
  };
  const stopRec = () => recRef.current?.state === 'recording' && recRef.current.stop();
  const cancelRec = () => { if (recRef.current?.state === 'recording') { chunksRef.current = []; recRef.current.stop(); } };

  const runSummary = async () => {
    setSummErr(null); setSummary(null); setSummBusy(true);
    try { setSummary(await summarizeMessages(thread, activeWo)); }
    catch (e) { setSummErr(e.message || 'Could not summarize'); }
    finally { setSummBusy(false); }
  };

  return (
    <div className="chat-wrap">
      <div className="view-head" style={{ marginBottom: 12 }}>
        <h1>Team chat</h1>
        <p>Office and crew, one thread — type or send a voice note</p>
      </div>

      {msgBackend === 'local' && isConfigured() && (
        <div className="offline">◐ On this device — syncs live to the whole crew once the messages migration is applied.</div>
      )}

      {/* channel switcher */}
      <div className="chan-bar">
        <button className="chan new" onClick={() => setPicker(true)} aria-label="New conversation">＋</button>
        {channels.map((c) => (
          <button key={c.id} className={'chan' + (channel === c.id ? ' on' : '')} onClick={() => { setChannel(c.id); setSummary(null); setSummErr(null); }}>
            {c.kind === 'dm' ? '@ ' + c.label : c.label}
          </button>
        ))}
      </div>

      {picker && <NewConversation roster={roster} onClose={() => setPicker(false)}
        onCreate={async (sel, name) => { const id = await addChannel({ kind: sel.length > 1 ? 'group' : 'dm', members: sel, name }); setPicker(false); setChannel(id); }} />}

      {/* thread */}
      <div className="chat-thread" ref={scroller}>
        {thread.length === 0 && <p className="note" style={{ textAlign: 'center', padding: 24 }}>No messages yet. Say something to {target}.</p>}
        {thread.map((m) => {
          const mine = m.senderId === myId || m.sender === myName;
          return (
            <div key={m.id} className={'msg' + (mine ? ' mine' : '')}>
              {!mine && <div className="msg-who">{m.sender || 'Crew'}{m.senderRole ? ` · ${m.senderRole}` : ''}</div>}
              <div className={'bubble' + (m.senderRole === 'office' ? ' office' : '')}>
                {m.body && <div className="msg-body">{m.body}</div>}
                {(m.imagePath || m.imageData) && <StoredImage className="msg-img" bucket="attachments" path={m.imageData ? null : m.imagePath} data={m.imageData || null} alt="Photo"
                  onOpen={() => setLb({ bucket: 'attachments', ...(m.imageData ? { data: m.imageData } : { path: m.imagePath }), name: 'Photo' })} />}
                {(m.filePath || m.fileData) && <div style={{ marginTop: m.body ? 6 : 0 }}><FileChip path={m.fileData ? null : m.filePath} data={m.fileData || null} name={m.fileName || 'file'} /></div>}
                {(m.voicePath || m.voiceData) && <VoiceNote msg={m} />}
                {mine && (delId === m.id ? (
                  <div className="msg-unsend confirm">
                    <span>Unsend?</span>
                    <button onClick={() => { deleteMessage(m.id); setDelId(null); }}>Unsend</button>
                    <button onClick={() => setDelId(null)}>Keep</button>
                  </div>
                ) : (
                  <button className="msg-unsend" onClick={() => setDelId(m.id)} aria-label="Unsend message"><IcTrash width={12} height={12} /></button>
                ))}
              </div>
              <div className="msg-time">{fmtTime(m.createdAt)}</div>
            </div>
          );
        })}
      </div>

      {/* AI summarize (office, per-job thread) */}
      {isOffice && isWoChannel && thread.length > 0 && (
        <div style={{ margin: '10px 0' }}>
          <button className="btn ghost sm" onClick={runSummary} disabled={summBusy}>
            <IcSparkle width={14} height={14} /> {summBusy ? 'Summarizing…' : 'Summarize thread → work-order update'}
          </button>
          {summErr && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>{summErr}</p>}
          {summary && (
            <div className="card" style={{ marginTop: 8, borderColor: 'color-mix(in srgb, var(--accent-2) 20%, transparent)' }}>
              <span className="field-label" style={{ color: 'var(--accent)' }}><IcSparkle width={12} height={12} /> AI summary</span>
              {summary.status && <div className="note" style={{ margin: '2px 0' }}>Status read: <b>{summary.status}</b></div>}
              {summary.summary && <div style={{ fontSize: 13, margin: '4px 0' }}>{summary.summary}</div>}
              {summary.nextSteps?.length > 0 && (
                <ul style={{ margin: '6px 0 0 18px', fontSize: 13, color: 'var(--text-dim)' }}>
                  {summary.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* composer */}
      {recErr && <p className="note" style={{ color: 'var(--danger)' }}>{recErr}</p>}
      {recording ? (
        <div className="composer">
          <button className="btn ghost icon-btn" style={{ color: 'var(--danger)' }} onClick={cancelRec} aria-label="Cancel"><IcX width={18} height={18} /></button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontWeight: 700 }}>
            <span className="live-dot" style={{ background: 'var(--danger)' }} /> Recording… {fmtSecs(recSecs)}
          </div>
          <button className="btn grad icon-btn" onClick={stopRec} aria-label="Send voice note"><IcSend width={18} height={18} /></button>
        </div>
      ) : (
        <>
          {attachFile && (
            <div className="attach-preview">
              {isImgAttach ? <img src={imgPreview} alt="" /> : <span className="ap-file"><IcClip width={16} height={16} /></span>}
              <span className="ap-name">{attachFile.name || (isImgAttach ? 'photo' : 'file')}</span>
              <button className="btn ghost sm icon-btn" onClick={() => setAttachFile(null)} aria-label="Remove attachment"><IcX width={14} height={14} /></button>
            </div>
          )}
          <div className="composer">
            <input style={inputStyle} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${target}…`}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <label className="btn ghost icon-btn" aria-label="Attach photo or file" style={{ cursor: 'pointer' }}>
              <IcClip width={18} height={18} />
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.heic" style={{ display: 'none' }} onChange={(e) => { setAttachFile(e.target.files?.[0] || null); e.target.value = ''; }} />
            </label>
            <button className="btn ghost icon-btn" onClick={startRec} aria-label="Record voice note"><IcMic width={18} height={18} /></button>
            <button className="btn grad icon-btn" onClick={() => send()} disabled={busy || (!text.trim() && !attachFile)} aria-label="Send"><IcSend width={18} height={18} /></button>
          </div>
        </>
      )}

      {lb && <Lightbox items={[lb]} index={0} onClose={() => setLb(null)} />}
    </div>
  );
}

// pick one person (DM) or several (named group) to start a conversation
function NewConversation({ roster, onClose, onCreate }) {
  const [sel, setSel] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (p) => setSel((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));
  const isGroup = sel.length > 1;
  const create = async () => { setBusy(true); try { await onCreate(sel, isGroup ? (name.trim() || 'Group') : null); } finally { setBusy(false); } };

  return (
    <div className="sheet-backdrop alloc-backdrop" onClick={onClose}>
      <div className="alloc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="alloc-head">
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>New conversation</div>
            <div className="note" style={{ margin: 0 }}>Pick one person for a DM, or several for a group</div>
          </div>
          <button className="btn ghost sm icon-btn" onClick={onClose} aria-label="Close"><IcX width={16} height={16} /></button>
        </div>
        {roster.length === 0 ? (
          <p className="note" style={{ padding: '18px 0' }}>No teammates to message yet — they appear here once they've signed in on their own device.</p>
        ) : (
          <>
            <div className="alloc-list" style={{ maxHeight: '46vh' }}>
              {roster.map((p) => (
                <label className={'alloc-row' + (sel.some((x) => x.id === p.id) ? ' on' : '')} key={p.id}>
                  <input type="checkbox" checked={sel.some((x) => x.id === p.id)} onChange={() => toggle(p)} />
                  <div className="lead"><div className="t">{p.label}</div><div className="s" style={{ textTransform: 'capitalize' }}>{p.role || 'crew'}</div></div>
                </label>
              ))}
            </div>
            {isGroup && (
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (e.g. Rochester crew)"
                style={{ width: '100%', marginTop: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 11, borderRadius: 3 }} />
            )}
            <button className="btn grad" style={{ marginTop: 14 }} onClick={create} disabled={busy || sel.length === 0}>
              {sel.length === 0 ? 'Pick someone' : isGroup ? `Create group · ${sel.length} people` : `Message ${sel[0].label}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// voice note: plays inline data URL (local) or a signed URL (cloud)
function VoiceNote({ msg }) {
  const [url, setUrl] = useState(msg.voiceData || null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    if (!url && msg.voicePath && isConfigured()) {
      signedFileUrl('voicenotes', msg.voicePath).then((u) => live && setUrl(u)).catch(() => live && setErr(true));
    }
    return () => { live = false; };
  }, [msg.voicePath]);
  if (err) return <div className="note" style={{ margin: 0 }}>voice note unavailable</div>;
  if (!url) return <div className="note" style={{ margin: 0 }}>◐ loading voice…</div>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: msg.body ? 6 : 0 }}>
      <IcMic width={14} height={14} style={{ flex: 'none', opacity: .7 }} />
      <audio controls src={url} style={{ height: 34, maxWidth: 200 }} />
      {msg.voiceSecs ? <span className="mono" style={{ fontSize: 11, opacity: .6 }}>{fmtSecs(msg.voiceSecs)}</span> : null}
    </div>
  );
}
