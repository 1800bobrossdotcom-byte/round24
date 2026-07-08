import { useState, useEffect } from 'react';
import { isConfigured, signedFileUrl } from '../lib/backend/supabase.js';

// Renders an image that lives either inline (demo: data URL) or in a private
// storage bucket (cloud: resolve a short-lived signed URL). Click opens the
// full image in a new tab. Used for work-order photos and chat images.
export default function StoredImage({ bucket, path, data, alt = '', className = 'thumb', style }) {
  const [url, setUrl] = useState(data || null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    if (!url && path && isConfigured()) {
      signedFileUrl(bucket, path).then((u) => live && setUrl(u)).catch(() => live && setErr(true));
    }
    return () => { live = false; };
  }, [path, bucket]);

  if (err) return <div className={className} style={{ ...style, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 11 }}>✕</div>;
  if (!url) return <div className={`${className} thumb-loading`} style={style} aria-label="loading image" />;
  return (
    <img src={url} alt={alt} className={className} style={style}
      onClick={() => window.open(url, '_blank', 'noopener')} />
  );
}
