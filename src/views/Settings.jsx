import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import {
  isConfigured, updatePassword, getUserSettings, saveUserSettings, signOutEverywhere,
  mfaFactors, mfaEnroll, mfaVerify, mfaUnenroll, exportMyData, requestAccountDeletion,
} from '../lib/backend/supabase.js';
import { IcGear, IcCheck, IcX, IcLogout, IcDoc, IcClip, IcMic } from '../components/ui.jsx';
import VoiceCommandGuide from '../components/VoiceCommandGuide.jsx';

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 10, borderRadius: 10,
};
const ROLE_LABEL = { admin: 'Office · Admin', manager: 'Office · Manager', tech: 'Contractor', viewer: 'Viewer' };

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on} style={{
      width: 42, height: 24, borderRadius: 999, border: '1px solid var(--line)', flex: 'none',
      background: on ? 'var(--money)' : 'var(--surface-2)', position: 'relative', cursor: 'pointer', transition: 'background .15s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}
function Row({ label, hint, children }) {
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <div className="lead"><div className="t">{label}</div>{hint && <div className="s">{hint}</div>}</div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}

export default function Settings({ store }) {
  const { role, orgId, orgName, session } = useAuth();
  const email = session?.user?.email || '';
  const myId = session?.user?.id;
  const isCrew = role === 'tech';
  const myAvail = (store.availability || []).find((a) => a.userId === myId)?.status || 'active';

  const [s, setS] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(null);
  const [clock24, setClock24] = useState(() => localStorage.getItem('caliper_clock12') !== '1');
  const em = s.emergency || {};
  const tax = s.tax || {};

  useEffect(() => {
    if (!isConfigured()) { setLoaded(true); return; }
    getUserSettings().then((d) => { setS(d || {}); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const patch = async (p) => {
    setS((x) => ({ ...x, ...p }));
    if (isConfigured()) { try { await saveUserSettings(orgId, p); flash('Saved'); } catch { /* local */ } }
  };
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(null), 1500); };

  if (!isConfigured()) {
    return (
      <div>
        <div className="view-head"><h1>Settings</h1><p>Your profile, security, and preferences</p></div>
        <div className="card" style={{ marginBottom: 'var(--gap)' }}><p className="note">Connect to the cloud to manage your account.</p></div>
        <div className="card">
          <span className="field-label"><IcMic width={12} height={12} /> Voice commands · hands-free</span>
          <VoiceCommandGuide />
        </div>
      </div>
    );
  }

  const notif = s.notif || { workOrders: true, chat: true, breaks: true, lunch: true };
  const setNotif = (k, v) => patch({ notif: { ...notif, [k]: v } });

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Settings</h1><p>Your profile, security, and preferences</p></div>
        {msg && <span className="chip" style={{ color: 'var(--money)' }}><IcCheck width={12} height={12} /> {msg}</span>}
      </div>

      {/* profile */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Profile</span>
        <div className="grid g2" style={{ marginTop: 6 }}>
          <div><div className="field-label">Display name</div>
            <input style={inputStyle} value={s.displayName ?? ''} onChange={(e) => setS((x) => ({ ...x, displayName: e.target.value }))} onBlur={(e) => patch({ displayName: e.target.value.trim() })} placeholder="Your name" /></div>
          <div><div className="field-label">Phone</div>
            <input style={inputStyle} value={s.phone ?? ''} onChange={(e) => setS((x) => ({ ...x, phone: e.target.value }))} onBlur={(e) => patch({ phone: e.target.value.trim() })} placeholder="(555) 555-5555" inputMode="tel" /></div>
        </div>
        <div className="s" style={{ marginTop: 10, color: 'var(--text-dim)', fontSize: 12 }}>{email} · {ROLE_LABEL[role] || role}{orgName ? ` · ${orgName}` : ''}</div>
      </div>

      {/* workspace branding — office admins/managers only */}
      {(role === 'admin' || role === 'manager') && <WorkspaceBranding store={store} orgName={orgName} flash={flash} />}

      {/* preferences */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Preferences</span>
        <Row label="24-hour clock" hint="Also switches the top bar clock">
          <Toggle on={clock24} onChange={(v) => { setClock24(v); localStorage.setItem('caliper_clock12', v ? '0' : '1'); window.dispatchEvent(new Event('caliper-clock')); }} />
        </Row>
        <Row label="Work-order alerts" hint="New & re-prioritized jobs"><Toggle on={notif.workOrders} onChange={(v) => setNotif('workOrders', v)} /></Row>
        <Row label="Chat notifications"><Toggle on={notif.chat} onChange={(v) => setNotif('chat', v)} /></Row>
        {isCrew && <>
          <Row label="Break reminders" hint="Nudge to stretch on long jobs"><Toggle on={notif.breaks} onChange={(v) => setNotif('breaks', v)} /></Row>
          <Row label="Lunch nudge"><Toggle on={notif.lunch} onChange={(v) => setNotif('lunch', v)} /></Row>
        </>}
      </div>

      {/* availability */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Availability</span>
        <div className="pick" style={{ marginTop: 4 }}>
          {[['active', 'On shift'], ['off', 'Off'], ['pto', 'PTO']].map(([v, l]) => (
            <button key={v} className={myAvail === v ? 'on' : ''} onClick={() => store.setMyAvailability(v)}>{l}</button>
          ))}
        </div>
        <div className="note" style={{ margin: '6px 0 0' }}>Your status shows on the office Day board in real time.</div>
      </div>

      {/* emergency contact */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Emergency contact</span>
        <div className="grid g3" style={{ gap: 8, marginTop: 4 }}>
          <input style={{ ...inputStyle, padding: 9 }} value={em.name ?? ''} onChange={(e) => setS((x) => ({ ...x, emergency: { ...em, name: e.target.value } }))} onBlur={() => patch({ emergency: em })} placeholder="Name" />
          <input style={{ ...inputStyle, padding: 9 }} value={em.relationship ?? ''} onChange={(e) => setS((x) => ({ ...x, emergency: { ...em, relationship: e.target.value } }))} onBlur={() => patch({ emergency: em })} placeholder="Relationship" />
          <input style={{ ...inputStyle, padding: 9 }} value={em.phone ?? ''} onChange={(e) => setS((x) => ({ ...x, emergency: { ...em, phone: e.target.value } }))} onBlur={() => patch({ emergency: em })} placeholder="Phone" inputMode="tel" />
        </div>
      </div>

      {/* tax / W-9 — contractors */}
      {isCrew && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Tax info · 1099 / W-9</span>
          <div className="note" style={{ margin: '2px 0 8px' }}>For year-end 1099s. We store only your legal name, classification, address, and the last 4 of your TIN — never the full number.</div>
          <div className="grid g2" style={{ gap: 8 }}>
            <input style={{ ...inputStyle, padding: 9 }} value={tax.legalName ?? ''} onChange={(e) => setS((x) => ({ ...x, tax: { ...tax, legalName: e.target.value } }))} onBlur={() => patch({ tax })} placeholder="Legal name" />
            <input style={{ ...inputStyle, padding: 9 }} value={tax.businessName ?? ''} onChange={(e) => setS((x) => ({ ...x, tax: { ...tax, businessName: e.target.value } }))} onBlur={() => patch({ tax })} placeholder="Business name (opt.)" />
            <select style={{ ...inputStyle, padding: 9 }} value={tax.classification ?? ''} onChange={(e) => { const t = { ...tax, classification: e.target.value }; setS((x) => ({ ...x, tax: t })); patch({ tax: t }); }}>
              <option value="">Tax classification…</option>
              {['Individual / Sole proprietor', 'Single-member LLC', 'LLC (C corp)', 'LLC (S corp)', 'Partnership', 'C corporation', 'S corporation'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input style={{ ...inputStyle, padding: 9 }} value={tax.tinLast4 ?? ''} onChange={(e) => setS((x) => ({ ...x, tax: { ...tax, tinLast4: e.target.value.replace(/\D/g, '').slice(0, 4) } }))} onBlur={() => patch({ tax })} placeholder="TIN last 4" inputMode="numeric" />
          </div>
          <input style={{ ...inputStyle, padding: 9, marginTop: 8 }} value={tax.address ?? ''} onChange={(e) => setS((x) => ({ ...x, tax: { ...tax, address: e.target.value } }))} onBlur={() => patch({ tax })} placeholder="Mailing address" />
          <div style={{ marginTop: 10 }}>
            <Row label="W-9 on file" hint={tax.w9SignedAt ? `Confirmed ${new Date(tax.w9SignedAt).toLocaleDateString()}` : 'Confirm your W-9 details are current'}>
              {tax.w9SignedAt
                ? <span className="chip" style={{ color: 'var(--money)' }}><IcCheck width={12} height={12} /> Confirmed</span>
                : <button className="btn ghost sm" onClick={() => { const t = { ...tax, w9SignedAt: new Date().toISOString() }; setS((x) => ({ ...x, tax: t })); patch({ tax: t }); }}>Confirm</button>}
            </Row>
          </div>
        </div>
      )}

      {/* security */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Security</span>
        <PasswordChange />
        <hr className="hr" />
        <TwoFactor />
        <hr className="hr" />
        <Row label="Sign out everywhere" hint="End all sessions on every device">
          <button className="btn ghost sm" onClick={signOutEverywhere}><IcLogout width={13} height={13} /> Sign out all</button>
        </Row>
      </div>

      {/* certifications — contractors */}
      {isCrew && <Certifications certs={s.certs || []} onChange={(certs) => patch({ certs })} />}

      {/* voice commands — hands-free help */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label"><IcMic width={12} height={12} /> Voice commands · hands-free</span>
        <VoiceCommandGuide />
      </div>

      {/* go-live: clear test/beta data (office only) */}
      {(role === 'admin' || role === 'manager') && <DangerZone store={store} />}

      {/* privacy & data */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Privacy &amp; data</span>
        <Row label="Download my data" hint="Everything we hold about you (JSON)">
          <button className="btn ghost sm" onClick={async () => {
            const data = await exportMyData(orgId);
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = 'caliper-my-data.json'; a.click(); URL.revokeObjectURL(url);
            store.audit && store.audit('export_data', 'my personal data');
          }}><IcDoc width={13} height={13} /> Export</button>
        </Row>
        <Row label="Terms &amp; Privacy" hint={<>
          <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Terms</a>
          {' · '}
          <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>Privacy Policy</a>
          {s.consent?.acceptedAt ? ` · accepted ${new Date(s.consent.acceptedAt).toLocaleDateString()}` : ''}
        </>}>
          {s.consent?.acceptedAt
            ? <span className="chip" style={{ color: 'var(--money)' }}><IcCheck width={12} height={12} /> Accepted</span>
            : <button className="btn ghost sm" onClick={() => patch({ consent: { acceptedAt: new Date().toISOString() } })}>Accept</button>}
        </Row>
        <Row label="Request account deletion" hint={s.deletionRequestedAt ? `Requested ${new Date(s.deletionRequestedAt).toLocaleDateString()} — an admin will process it` : 'Right to erasure'}>
          {s.deletionRequestedAt
            ? <span className="chip warn">Pending</span>
            : <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={async () => { if (confirm('Request deletion of your account and personal data? An admin will process this.')) { try { await requestAccountDeletion(); } catch { /* ignore */ } patch({ deletionRequestedAt: new Date().toISOString() }); } }}>Request</button>}
        </Row>
      </div>

      <p className="note">We encrypt sensitive identity fields (legal name, tax identifiers, address, emergency contact) with AES-256 backed by AWS KMS, and isolate every workspace with row-level security. You control your data — export or request deletion anytime.</p>
    </div>
  );
}

// go-live reset — clears this workspace's test/operational data so a beta org
// starts clean. Typed-confirm gated; portfolio kept unless opted in.
function DangerZone({ store }) {
  const [open, setOpen] = useState(false);
  const [includePortfolio, setIncludePortfolio] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const run = async () => {
    setBusy(true);
    try { await store.resetWorkspace({ cloud: true, includePortfolio }); setDone('Workspace cleared. Reload to start fresh.'); setConfirm(''); setOpen(false); }
    catch { setDone('Cleared local data. Some cloud rows may remain — check the dashboard.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--danger)' }}>
      <span className="field-label" style={{ color: 'var(--danger)' }}>Danger zone · go-live reset</span>
      <p className="note" style={{ margin: '2px 0 8px' }}>
        Clears this workspace's <b>test data</b> — timers, work orders, purchases, docs, messages, and the imported labor spine — so beta starts clean. Sample data is already off for a live org.
      </p>
      {!open ? (
        <button className="btn ghost sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setOpen(true)}>Clear test data…</button>
      ) : (
        <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
          <Row label="Also clear rent roll &amp; vendors" hint="Off = keep your imported portfolio, wipe only operational test data">
            <Toggle on={includePortfolio} onChange={setIncludePortfolio} />
          </Row>
          <p className="note" style={{ margin: '8px 0 6px' }}>Type <b>RESET</b> to confirm — this can't be undone.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, letterSpacing: '.15em' }} value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} placeholder="RESET" />
            <button className="btn" style={{ background: 'var(--danger)', color: '#fff', flex: 'none' }} disabled={confirm !== 'RESET' || busy} onClick={run}>{busy ? 'Clearing…' : 'Clear'}</button>
            <button className="btn ghost sm" onClick={() => { setOpen(false); setConfirm(''); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {done && <p className="note" style={{ color: 'var(--money)', marginTop: 8 }}>{done}</p>}
    </div>
  );
}

function PasswordChange() {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [done, setDone] = useState(false);
  const ok = pw.length >= 6 && pw === pw2;
  const submit = async () => { setErr(null); setBusy(true); try { await updatePassword(pw); setDone(true); setPw(''); setPw2(''); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div>
      <div className="field-label" style={{ marginTop: 4 }}>Change password</div>
      <div className="grid g2" style={{ gap: 8 }}>
        <input style={inputStyle} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" />
        <input style={inputStyle} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm" />
      </div>
      {err && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</p>}
      {done && <p className="note" style={{ color: 'var(--money)', marginTop: 6 }}>Password updated.</p>}
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={submit} disabled={!ok || busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </div>
  );
}

function TwoFactor() {
  const [factors, setFactors] = useState([]);
  const [enroll, setEnroll] = useState(null); // { id, secret, uri }
  const [code, setCode] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => mfaFactors().then((f) => setFactors(f.filter((x) => x.status === 'verified'))).catch(() => {});
  useEffect(() => { load(); }, []);
  const start = async () => { setErr(null); try { const d = await mfaEnroll(); setEnroll({ id: d.id, secret: d.totp?.secret, uri: d.totp?.uri, qr: d.totp?.qr_code }); } catch (e) { setErr(e.message); } };
  const verify = async () => { setBusy(true); setErr(null); try { await mfaVerify(enroll.id, code.trim()); setEnroll(null); setCode(''); load(); } catch (e) { setErr('That code didn’t verify — try the next one.'); } finally { setBusy(false); } };
  const remove = async (id) => { await mfaUnenroll(id).catch(() => {}); load(); };
  const active = factors.length > 0;
  return (
    <div>
      <Row label="Two-factor authentication" hint={active ? 'On — authenticator app required at sign-in' : 'Add a second layer with an authenticator app'}>
        {active
          ? <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => remove(factors[0].id)}>Turn off</button>
          : !enroll && <button className="btn ghost sm" onClick={start}>Turn on</button>}
      </Row>
      {enroll && (
        <div className="card" style={{ background: 'var(--surface-2)', marginTop: 4 }}>
          <p className="note" style={{ margin: 0 }}>Scan this with your authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code. Can’t scan? Type the key below.</p>
          {enroll.qr && (
            <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
              <div style={{ background: '#fff', padding: 10, borderRadius: 10, width: 172, height: 172, display: 'grid', placeItems: 'center' }}>
                {enroll.qr.startsWith('data:')
                  ? <img src={enroll.qr} alt="2FA QR code" style={{ width: '100%', height: '100%' }} />
                  : <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: enroll.qr }} />}
              </div>
            </div>
          )}
          <div className="mono" style={{ margin: '8px 0', fontSize: 12, wordBreak: 'break-all', color: 'var(--text-dim)', textAlign: 'center' }}>{enroll.secret}</div>
          {err && <p className="note" style={{ color: 'var(--danger)' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, letterSpacing: '.2em', textAlign: 'center' }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" inputMode="numeric" />
            <button className="btn grad sm" onClick={verify} disabled={busy || code.length !== 6}>Verify</button>
          </div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setEnroll(null)}>Cancel</button>
        </div>
      )}
      {!enroll && err && <p className="note" style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  );
}

// contractor license / insurance with expiry awareness (compliance)
function Certifications({ certs, onChange }) {
  const [name, setName] = useState(''); const [number, setNumber] = useState(''); const [expiry, setExpiry] = useState('');
  const add = () => { if (!name.trim()) return; onChange([...certs, { id: Math.random().toString(36).slice(2, 8), name: name.trim(), number: number.trim(), expiry }]); setName(''); setNumber(''); setExpiry(''); };
  const remove = (id) => onChange(certs.filter((c) => c.id !== id));
  const soon = (d) => d && (new Date(d) - Date.now()) < 45 * 86400000;
  const expired = (d) => d && new Date(d) < new Date();
  return (
    <div className="card" style={{ marginBottom: 'var(--gap)' }}>
      <span className="field-label"><IcClip width={12} height={12} /> Licenses &amp; insurance</span>
      {certs.length === 0 && <p className="note">Add your license, insurance, or certifications so the office has them on file.</p>}
      {certs.map((c) => (
        <div className="row" key={c.id}>
          <div className="lead">
            <div className="t">{c.name}{c.number ? ` · ${c.number}` : ''}</div>
            <div className="s" style={{ color: expired(c.expiry) ? 'var(--danger)' : soon(c.expiry) ? 'var(--warn)' : 'var(--text-dim)' }}>
              {c.expiry ? `${expired(c.expiry) ? 'Expired' : 'Expires'} ${c.expiry}` : 'No expiry'}
            </div>
          </div>
          <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => remove(c.id)} aria-label="Remove"><IcX width={14} height={14} /></button>
        </div>
      ))}
      <div className="grid g3" style={{ gap: 8, marginTop: 10 }}>
        <input style={{ ...inputStyle, padding: 9 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HVAC license" />
        <input style={{ ...inputStyle, padding: 9 }} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Number (opt.)" />
        <input style={{ ...inputStyle, padding: 9 }} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={add} disabled={!name.trim()}>+ Add</button>
    </div>
  );
}

// Workspace branding — the org's own name + logo. Replaces any hardcoded brand:
// each workspace shows ITS logo (or the Caliper fallback), never another tenant's.
function WorkspaceBranding({ store, orgName, flash }) {
  const [name, setName] = useState(orgName || '');
  const [busy, setBusy] = useState(false);
  const logo = store.orgLogo || null;
  useEffect(() => { setName(orgName || ''); }, [orgName]);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === orgName) return;
    setBusy(true); const r = await store.setOrgBranding({ name: n }); setBusy(false);
    flash(r?.ok ? 'Workspace name saved' : 'Could not save');
  };
  const onLogo = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true); const r = await store.setOrgBranding({ logoFile: f }); setBusy(false);
    flash(r?.ok ? 'Logo updated' : 'Upload failed');
  };
  const removeLogo = async () => {
    if (!window.confirm('Remove the workspace logo? It will fall back to the Caliper mark.')) return;
    setBusy(true); const r = await store.setOrgBranding({ logoUrl: null }); setBusy(false);
    flash(r?.ok ? 'Logo removed' : 'Could not remove');
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--gap)' }}>
      <span className="field-label">Workspace branding</span>
      <p className="note" style={{ margin: '2px 0 12px' }}>Your workspace name and logo — shown in the app header and on your residents' repair-request page. Each workspace is branded on its own; nothing carries over from another.</p>

      <div className="field-label">Workspace name</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Evolution24 Properties" />
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={saveName} disabled={busy || !name.trim() || name.trim() === orgName}>Save</button>
      </div>

      <div className="field-label" style={{ marginTop: 14 }}>Logo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ height: 56, minWidth: 120, display: 'flex', alignItems: 'center', padding: '0 12px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10 }}>
          {logo
            ? <img src={logo} alt="Workspace logo" style={{ maxHeight: 44, maxWidth: 200, objectFit: 'contain' }} />
            : <span className="s" style={{ color: 'var(--text-faint)' }}>Caliper (default)</span>}
        </div>
        <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer' }}>
          {logo ? 'Replace logo' : 'Upload logo'}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={onLogo} disabled={busy} />
        </label>
        {logo && <button className="btn ghost sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={removeLogo} disabled={busy}>Remove</button>}
      </div>
      <p className="note" style={{ margin: '8px 0 0', color: 'var(--text-faint)' }}>PNG with a transparent background works best. Shown small — a wide/horizontal logo reads best.</p>
    </div>
  );
}
