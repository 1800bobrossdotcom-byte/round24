import { useState, useEffect } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';
import { IcDoc } from './ui.jsx';

// A downloadable (non-image) attachment: PDF, doc, etc. Resolves a signed URL
// in the cloud or uses an inline data URL in demo. Clicking opens it.
export function FileChip({ bucket = 'attachments', path, data, name = 'file' }) {
  const [url, setUrl] = useState(data || null);
  useEffect(() => {
    // reset on input change so an index-keyed chip never opens the previous file after a delete/reorder
    let live = true;
    if (data) { setUrl(data); return () => { live = false; }; }
    setUrl(null);
    if (path && isConfigured()) {
      signedFileUrl(bucket, path).then((u) => live && setUrl(u)).catch(() => {});
    }
    return () => { live = false; };
  }, [path, bucket, data]);

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
