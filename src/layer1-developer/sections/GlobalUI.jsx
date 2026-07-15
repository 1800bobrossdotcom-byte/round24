// src/layer1-developer/sections/GlobalUI.jsx
// The concrete "Layer 1 controls UI/UX" surface: a banner every signed-in
// user in every workspace can see (platform_flags.banner), plus the raw
// flag list for whatever ships next (e.g. platform_flags.changelog).
import { useEffect, useState } from 'react';
import { layer1GetFlags, layer1SetFlag } from '../../lib/backend/layer1Api.js';

const TONES = ['info', 'warn', 'danger'];

export default function GlobalUI() {
  const [flags, setFlags] = useState(null);
  const [banner, setBanner] = useState({ on: false, tone: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  const load = () => layer1GetFlags().then((rows) => {
    setFlags(rows);
    const b = rows.find((r) => r.key === 'banner')?.value;
    if (b) setBanner({ on: !!b.on, tone: b.tone || 'info', text: b.text || '' });
  });

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await layer1SetFlag('banner', banner);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font)', fontWeight: 600, color: 'var(--text)' }}>
            Global announcement banner
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            <input
              type="checkbox"
              checked={banner.on}
              onChange={(e) => setBanner((b) => ({ ...b, on: e.target.checked }))}
            />
            On for every workspace
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {TONES.map((t) => (
            <button
              key={t}
              className="btn ghost sm"
              aria-pressed={banner.tone === t}
              style={banner.tone === t ? { borderColor: `var(--${t === 'warn' ? 'warn' : t})`, color: `var(--${t})` } : undefined}
              onClick={() => setBanner((b) => ({ ...b, tone: t }))}
            >
              {t}
            </button>
          ))}
        </div>

        <textarea
          value={banner.text}
          onChange={(e) => setBanner((b) => ({ ...b, text: e.target.value }))}
          placeholder="e.g. Scheduled maintenance tonight 11pm–1am ET"
          rows={2}
          style={{
            fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)',
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)', padding: 10, resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn grad sm" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Publish to every workspace'}
          </button>
        </div>
        <p style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
          Renders for every signed-in user, every org, on next load — reads platform_flags.banner,
          a plain select any authenticated (or anon) client can already make.
        </p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <p style={{ fontFamily: 'var(--font)', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>
          Other flags
        </p>
        {!flags && <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-faint)' }}>···</p>}
        {flags && flags.filter((f) => f.key !== 'banner').length === 0 && (
          <p style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--text-faint)' }}>
            None yet — e.g. a future `changelog` array would show up here.
          </p>
        )}
        {flags?.filter((f) => f.key !== 'banner').map((f) => (
          <div key={f.key} className="row" style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{f.key}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {JSON.stringify(f.value).slice(0, 40)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
