import { useState, useEffect, useCallback } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';
import { IcX, IcChevron } from './ui.jsx';

// Full-screen image viewer / carousel. `items` is [{ bucket, path, data, name }].
// Resolves a signed URL for the active item (data URLs used as-is). Arrow keys
// and on-screen chevrons page through; Esc or backdrop click closes.
export default function Lightbox({ items = [], index = 0, onClose }) {
  const [i, setI] = useState(index);
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  const n = items.length;
  const cur = items[i];

  const go = useCallback((d) => { setI((x) => (x + d + n) % n); }, [n]);

  useEffect(() => {
    setUrl(null); setErr(false);
    if (!cur) return;
    if (cur.data) { setUrl(cur.data); return; }
    let live = true;
    if (cur.path && isConfigured()) {
      signedFileUrl(cur.bucket || 'attachments', cur.path)
        .then((u) => live && setUrl(u)).catch(() => live && setErr(true));
    }
    return () => { live = false; };
  }, [i, cur]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && n > 1) go(1);
      else if (e.key === 'ArrowLeft' && n > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, n, onClose]);

  if (!cur) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <button className="lb-close" onClick={onClose} aria-label="Close"><IcX width={20} height={20} /></button>
      {n > 1 && <button className="lb-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous"><IcChevron width={26} height={26} style={{ transform: 'rotate(180deg)' }} /></button>}
      {n > 1 && <button className="lb-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next"><IcChevron width={26} height={26} /></button>}

      <div className="lb-stage" onClick={(e) => e.stopPropagation()}>
        {err ? <div className="lb-msg">Image unavailable</div>
          : !url ? <div className="lb-msg">◐ loading…</div>
          : <img src={url} alt={cur.name || 'Photo'} className="lb-img" />}
      </div>

      <div className="lb-foot" onClick={(e) => e.stopPropagation()}>
        {n > 1 && <span className="lb-count mono">{i + 1} / {n}</span>}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="lb-open">Open original ↗</a>}
      </div>
    </div>
  );
}
