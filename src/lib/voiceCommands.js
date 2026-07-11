// ============================================================
// Caliper voice commands — the spoken grammar for hands-free field work.
// Gloves on, up a ladder, hands full of a P-trap: say it instead of tapping.
//
// Every command starts with the wake word "Caliper", then a plain-English
// phrase. This file is the single source of truth: the Field mic dispatches
// off `parseCommand`, and the help/FAQ (and later the pricing page) renders
// off `VOICE_COMMANDS`. Pure + dependency-free so it's trivially testable.
// ============================================================

export const WAKE_WORD = 'caliper';

// intent → what the app does. `phrases` are everything we accept; `say` is the
// canonical example we show people. Keep phrases lowercase, no punctuation.
export const VOICE_COMMANDS = [
  {
    group: 'Timer', intent: 'start', title: 'Start the clock on a job',
    say: 'Caliper, start job',
    phrases: ['start job', 'start task', 'start work', 'start the job', 'start timer', 'start the timer', 'start the clock', 'clock in', 'clock on', 'begin job'],
  },
  {
    group: 'Timer', intent: 'stop', title: 'Stop & log the hours to this job',
    say: 'Caliper, stop job',
    phrases: ['stop job', 'stop task', 'stop work', 'stop the job', 'stop timer', 'stop the timer', 'stop the clock', 'clock out', 'log it', 'log the job', 'save job'],
  },
  {
    group: 'Timer', intent: 'done', title: 'Stop & mark the work order done',
    say: 'Caliper, mark it done',
    phrases: ['mark done', 'mark it done', 'mark complete', 'finish job', 'finish the job', 'job done', 'job is done', 'work order done', 'all done', 'complete the job'],
  },
  {
    group: 'Breaks', intent: 'break', title: 'Take a break — the clock pauses',
    say: 'Caliper, take a break',
    phrases: ['take a break', 'take break', 'start break', 'break time', 'pause', 'pause the clock', 'stepping away', 'going to lunch', 'lunch break'],
  },
  {
    group: 'Breaks', intent: 'resume', title: 'Back to work — the clock resumes',
    say: 'Caliper, back to work',
    phrases: ['back to work', 'back on the clock', 'resume', 'end break', 'off break', 'keep going', 'im back', 'i am back'],
  },
  {
    group: 'Status', intent: 'status', title: 'Hear your running time out loud',
    say: 'Caliper, status',
    phrases: ['status', 'how long', 'how long have i been', 'time check', 'whats my time', 'where am i', 'am i on the clock'],
  },
];

// flat phrase→intent index, longest phrase first so a specific match ("back to
// work") wins over a substring ("work"). Built once at module load.
const PHRASE_INDEX = VOICE_COMMANDS
  .flatMap((c) => c.phrases.map((phrase) => ({ phrase, intent: c.intent })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

// normalize speech to bare words: lowercase, strip punctuation, collapse space.
// Speech engines often return "Caliper, stop job." — we want "caliper stop job".
export function normalize(raw) {
  return (raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// parse a spoken utterance into an intent. Requires the wake word somewhere in
// the phrase; matches the command that appears AFTER it. Returns null when
// there's no wake word (so the mic ignores ordinary chatter), or
// { intent: null, heard } when we heard the wake word but no known command.
export function parseCommand(raw) {
  const t = normalize(raw);
  if (!t) return null;
  const wi = t.lastIndexOf(WAKE_WORD);
  if (wi === -1) return null;                 // no wake word → not for us
  const after = t.slice(wi + WAKE_WORD.length).trim();
  if (!after) return { intent: null, heard: '' };
  for (const { phrase, intent } of PHRASE_INDEX) {
    if (after.includes(phrase)) return { intent, phrase, heard: after };
  }
  return { intent: null, heard: after };
}
