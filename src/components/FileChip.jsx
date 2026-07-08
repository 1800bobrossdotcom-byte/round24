import { useState, useEffect } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';
import { IcDoc } from './ui.jsx';

// A downloadable (non-image) attachment: PDF, doc, etc. Resolves a signed URL
// in the cloud or uses an inline data URL in demo. Clicking opens it.
export function FileChip({ bucket = 'attachments', path, data, name = 'file' }) {
  const [url, setUrl] = useState(data || null);
  useEffect(() => {
    let live = true;
    if (!url && path && isConfigured()) {
      signedFileUrl(bucket, path).then((u) => live && setUrl(u)).catch(() => {});
    }
    return () => { live = false; };
  }, [path, bucket]);

  const ext = (name.split('.').pop() || '').toUpperCase().slice(0, 4);
  const open = () => { if (url) window.open(url, '_blank', 'noopener'); };
  return (
    <button className="file-chip" onClick={open} title={name} disabled={!url}>
      <span className="fc-ic"><IcDoc width={16} height={16} /></span>
      <span className="fc-main">
        <span className="fc-name">{name}</span>
        {ext && <span className="fc-ext">{ext}</span>}
      </span>
    </button>
  );
}
