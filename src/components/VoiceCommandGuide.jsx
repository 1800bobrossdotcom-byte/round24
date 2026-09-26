import { VOICE_COMMANDS } from '../lib/voiceCommands.js';
import { isVoiceSupported } from '../lib/voice.js';
import { IcMic, IcCheck } from './ui.jsx';

// The spoken-command reference. Rendered from the same catalog the Field mic
// dispatches off, so the list can never drift from what actually works. Used in
// Settings/help today; drop-in for the pricing/FAQ page later (pass `marketing`
// to hide the app-only "supported on this device" line).
export default function VoiceCommandGuide({ compact = false, marketing = false }) {
  const supported = isVoiceSupported();
  const groups = [...new Set(VOICE_COMMANDS.map((c) => c.group))];

  return (
    <div className="voice-guide">
      {!compact && (
        <p className="note" style={{ margin: '0 0 12px' }}>
          Every command starts with the wake word <b>“Round 24.”</b> Say it, then the phrase —
          you don’t have to touch the phone. Round 24 says the result back so you know it landed.
        </p>
      )}

      {groups.map((g) => (
        <div key={g} style={{ marginBottom: compact ? 10 : 16 }}>
          <span className="field-label" style={{ margin: '0 0 6px' }}>{g}</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {VOICE_COMMANDS.filter((c) => c.group === g).map((c) => (
              <div key={c.intent} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="voice-say mono" style={{
                  flex: 'none', color: 'var(--accent)', fontWeight: 700, fontSize: 13,
                  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 3, padding: '3px 8px',
                }}>
                  <IcMic width={11} height={11} style={{ verticalAlign: -1, marginRight: 4, opacity: 0.8 }} />“{c.say}”
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{c.title}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!compact && !marketing && (
        <p className="note" style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6, color: supported ? 'var(--money)' : 'var(--text-dim)' }}>
          {supported
            ? <><IcCheck width={13} height={13} /> Voice is supported on this device — turn on <b>Hands-free</b> in the Field timer.</>
            : <>This browser doesn’t support in-app voice yet — works in Chrome, Edge, and Android. The commands above still apply once supported.</>}
        </p>
      )}
    </div>
  );
}
