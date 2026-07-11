// ============================================================
// Web Speech engine for hands-free field commands. Continuous listening for
// the "Caliper …" wake word, in-browser (no audio ever leaves the device on
// supporting browsers). Feature-detected — degrades to a no-op where the
// SpeechRecognition API isn't available (e.g. Firefox, most iOS Safari).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { parseCommand } from './voiceCommands.js';

function getSR() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  return !!getSR();
}

// speak a short confirmation ("Stopped and logged.") so the crew gets audible
// feedback without looking at the phone. Best-effort; silent where unsupported.
export function speak(text) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1; u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  } catch { /* no voice out — the on-screen state still updates */ }
}

// Hands-free command loop. Pass enabled + an onCommand(intent, info) handler;
// the hook keeps the latest handler so it always dispatches against fresh state.
// Returns { supported, listening, error, lastHeard }.
export function useVoiceCommands({ enabled, onCommand, onHeard }) {
  const supported = isVoiceSupported();
  const cbRef = useRef({});
  cbRef.current = { onCommand, onHeard };
  const recRef = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const [lastHeard, setLastHeard] = useState('');

  useEffect(() => {
    if (!supported || !enabled) return undefined;
    const SR = getSR();
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    recRef.current = rec;
    setError(null);

    rec.onstart = () => { setListening(true); setError(null); }; // a clean (re)start clears any transient "paused" state
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (!res || !res.isFinal) return;
      const transcript = res[0]?.transcript || '';
      const cmd = parseCommand(transcript);
      if (cmd === null) return;                 // no wake word → ignore chatter
      setLastHeard(transcript.trim());
      cbRef.current.onHeard?.(transcript.trim(), cmd);
      if (cmd.intent) cbRef.current.onCommand?.(cmd.intent, cmd);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone blocked — allow mic access to use voice.');
        enabledRef.current = false;             // don't fight a denied permission
      }
      // everything else ('no-speech', 'aborted', 'audio-capture' when the phone
      // backgrounds for the food map, transient 'network') is recoverable — the
      // onend auto-restart + the visibility handler below bring it back, so we
      // don't flash a scary "paused" message the crew would have to tap away.
    };
    const kick = () => { if (enabledRef.current) { try { rec.start(); } catch { /* already running */ } } };
    rec.onend = () => { setListening(false); kick(); };

    // when the crew taps "Food near the job site" (opens Maps in another tab) the
    // page is suspended and the mic stops; resume listening the moment they're back.
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    document.addEventListener('visibilitychange', onVisible);

    try { rec.start(); } catch { /* start races settle via onend */ }
    return () => {
      enabledRef.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      try { rec.onend = null; rec.stop(); } catch { /* already stopped */ }
      recRef.current = null;
      setListening(false);
    };
  }, [enabled, supported]);

  return { supported, listening, error, lastHeard };
}
