import { useEffect, useRef, useState } from 'react';

// Two-step destructive action, inline — the one confirm pattern for the app,
// replacing window.confirm(). First tap arms it ("Delete? Yes / No"); Yes
// fires onConfirm; No, any other tap, or four seconds disarm it. Keeps a
// crew member's thumb in the flow on a phone, works offline, and reads the
// same everywhere a row can be removed.
export default function ConfirmButton({ onConfirm, children, label = 'Sure?', yes = 'Yes', className = 'btn ghost sm', style, disabled, title, ...rest }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const arm = () => { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 4000); };
  const disarm = () => { clearTimeout(timer.current); setArmed(false); };
  if (!armed) {
    return <button type="button" className={className} style={style} disabled={disabled} title={title} onClick={arm} {...rest}>{children}</button>;
  }
  return (
    <span className="confirm-inline" role="group" aria-label={label}>
      <span className="confirm-q">{label}</span>
      <button type="button" className="btn stop sm" onClick={() => { disarm(); onConfirm(); }}>{yes}</button>
      <button type="button" className="btn ghost sm" onClick={disarm}>No</button>
    </span>
  );
}
