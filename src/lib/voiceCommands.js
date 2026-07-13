// ============================================================
// Caliper voice commands — the spoken grammar for hands-free field work.
// Gloves on, up a ladder, hands full of a P-trap: say it instead of tapping.
//
// Every command starts with the wake word "Caliper", then a plain-English
// phrase. This file is the single source of truth: the Field mic dispatches
// off `parseCommand`, and the help/FAQ (and later the pricing page) renders
// off `VOICE_COMMANDS`. Pure + dependency-free so it's trivially testable.
//
// Job sites are LOUD (compressors, music, traffic) so the recognizer mis-hears
// — "start job" comes back as "stock job". parseCommand therefore does an exact
// pass first, then a fuzzy pass that (a) tolerates garbled words and (b) uses
// the live timer state to resolve the risky start/stop pair (you can't start a
// job that's already running, or stop one that isn't). A fuzzy match on a
// destructive action returns `confirm:true` so the caller can ask before acting.
// ============================================================

export const WAKE_WORD = 'caliper';

// intent → what the app does. `phrases` are exact accepts; `anchors` are the
// distinctive single words the fuzzy matcher scores against; `say` is the
// canonical example we show people. Keep everything lowercase, no punctuation.
export const VOICE_COMMANDS = [
  {
    group: 'Timer', intent: 'start', title: 'Start the clock on a job',
    say: 'Caliper, start job',
    phrases: ['start job', 'start task', 'start work', 'start the job', 'start timer', 'start the timer', 'start the clock', 'clock in', 'clock on', 'begin job', 'start', 'begin'],
    anchors: ['start', 'begin', 'commence', 'clockin', 'clockon', 'startup', 'starting'],
  },
  {
    group: 'Timer', intent: 'stop', title: 'Stop & log the hours to this job',
    say: 'Caliper, stop job',
    phrases: ['stop job', 'stop task', 'stop work', 'stop the job', 'stop timer', 'stop the timer', 'stop the clock', 'clock out', 'log it', 'log the job', 'save job', 'stop'],
    anchors: ['stop', 'clockout', 'logit', 'wrap', 'wrapup', 'stopping', 'halt'],
  },
  {
    group: 'Timer', intent: 'done', title: 'Stop & mark the work order done',
    say: 'Caliper, mark it done',
    phrases: ['mark done', 'mark it done', 'mark complete', 'finish job', 'finish the job', 'job done', 'job is done', 'work order done', 'all done', 'complete the job'],
    anchors: ['done', 'complete', 'completed', 'finish', 'finished', 'finishing'],
  },
  {
    group: 'Timer', intent: 'pauseJob', title: 'Park this job to switch to another',
    say: 'Caliper, pause job',
    phrases: ['pause job', 'pause the job', 'pause this job', 'park job', 'park the job', 'park it', 'switch job', 'switch jobs', 'switch to another job', 'set it aside', 'set aside'],
    anchors: ['park', 'parked', 'parking', 'switch', 'switching', 'aside'],
  },
  {
    group: 'Breaks', intent: 'break', title: 'Take a break — the clock pauses',
    say: 'Caliper, take a break',
    phrases: ['take a break', 'take break', 'start break', 'break time', 'pause', 'pause the clock', 'stepping away', 'going to lunch', 'lunch break', 'break'],
    anchors: ['break', 'brake', 'lunch', 'pause', 'paused', 'rest', 'breather'],
  },
  {
    group: 'Breaks', intent: 'resume', title: 'Back to work — the clock resumes',
    say: 'Caliper, back to work',
    phrases: ['back to work', 'back on the clock', 'resume', 'end break', 'off break', 'keep going', 'im back', 'i am back'],
    anchors: ['resume', 'resumed', 'continue', 'unpause', 'returning', 'back'],
  },
  {
    group: 'Status', intent: 'status', title: 'Hear your running time out loud',
    say: 'Caliper, status',
    phrases: ['status', 'how long', 'how long have i been', 'time check', 'whats my time', 'where am i', 'am i on the clock'],
    anchors: ['status', 'update', 'timecheck', 'howlong'],
  },
];

// yes/no for confirming an uncertain command. Not shown in the help grid, but
// parseable so a fuzzy destructive match can be confirmed by voice.
const CONFIRMERS = [
  { intent: 'confirm', anchors: ['yes', 'yeah', 'yep', 'yup', 'confirm', 'confirmed', 'correct', 'affirmative', 'doit'], phrases: ['yes', 'yeah', 'yep', 'yup', 'confirm', 'correct', 'do it', 'go ahead'] },
  { intent: 'cancel', anchors: ['no', 'nope', 'cancel', 'nevermind', 'abort', 'negative', 'stopstop'], phrases: ['no', 'nope', 'cancel', 'never mind', 'abort', 'forget it'] },
];
const ALL = [...VOICE_COMMANDS, ...CONFIRMERS];

// flat phrase→intent index, longest phrase first so a specific match ("back to
// work") wins over a substring ("work"). Built once at module load.
const PHRASE_INDEX = ALL
  .flatMap((c) => c.phrases.map((phrase) => ({ phrase, intent: c.intent })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

// normalize speech to bare words: lowercase, strip punctuation, collapse space.
// Speech engines often return "Caliper, stop job." — we want "caliper stop job".
export function normalize(raw) {
  return (raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Levenshtein edit distance + a 0..1 similarity, for tolerating mis-hears.
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}
const sim = (a, b) => { const L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 1; };

const FUZZY_MIN = 0.6;   // token must be at least this similar to an anchor to count
const WAKE_MIN = 0.72;   // "caliber"/"calibre" still count as the wake word

// which intents make sense given the live timer state — this is what safely
// resolves start-vs-stop when the word itself is garbled. No context → allow all.
function validForContext(ctx) {
  if (!ctx || ctx.running === undefined) return null;
  const s = new Set(['status', 'confirm', 'cancel']);
  if (ctx.running) { s.add('stop'); s.add('done'); s.add('pauseJob'); s.add(ctx.onBreak ? 'resume' : 'break'); }
  else s.add('start');
  return s;
}

// best fuzzy score of a command's anchors against the spoken tokens. A fuzzy
// (non-exact) match only counts when BOTH the token and anchor are >= 4 chars —
// short words ("up","now","top","gone") are too collision-prone to infer from,
// so they must match exactly. This keeps ambient 2-3 letter noise from firing a command.
function scoreCommand(cmd, tokens) {
  let best = 0, hit = '';
  for (const a of cmd.anchors) {
    for (const tk of tokens) {
      if (tk === a) { best = 1; hit = a; continue; }         // exact token, any length
      if (tk.length < 4 || a.length < 4) continue;           // too short to fuzzy-match safely
      const s = sim(tk, a);
      if (s > best) { best = s; hit = a; }
    }
  }
  return { score: best, hit };
}

// parse a spoken utterance into an intent. Requires the wake word (fuzzily)
// somewhere in the phrase; matches the command that appears AFTER it.
// ctx = { running, onBreak } lets the fuzzy pass disambiguate by timer state.
// Returns:
//   null                              → no wake word (ignore ordinary chatter)
//   { intent, confidence:'exact' }    → an exact phrase matched
//   { intent, confidence:'fuzzy', confirm } → a garbled word was inferred; confirm=true for destructive actions
//   { intent:null, heard, suggestion }→ wake word heard but no confident match
export function parseCommand(raw, ctx) {
  const t = normalize(raw);
  if (!t) return null;
  const toks = t.split(' ');
  // fuzzy wake-word detection: last token that is (near) "caliper"
  let wi = -1;
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i] === WAKE_WORD || (toks[i].length >= 5 && sim(toks[i], WAKE_WORD) >= WAKE_MIN)) { wi = i; break; }
  }
  if (wi === -1) return null;                 // not for us
  const afterToks = toks.slice(wi + 1);
  const after = afterToks.join(' ');
  if (!after) return { intent: null, heard: '' };

  // 1) exact phrase — WHOLE-word/phrase match (space-padded so "breaker" can't
  //    match "break", "yesterday" can't match "yes"). Fast, unambiguous, no confirm.
  const hay = ` ${after} `;
  for (const { phrase, intent } of PHRASE_INDEX) {
    if (hay.includes(` ${phrase} `)) return { intent, phrase, heard: after, confidence: 'exact', confirm: false };
  }

  // 2) fuzzy — score the COMMANDS only (yes/no are exact-only above; inferring them
  //    from noise is pure risk), then keep the best valid for the current timer state
  //    (this is what turns "stock job" into the right action).
  const valid = validForContext(ctx);
  const ranked = VOICE_COMMANDS
    .map((c) => ({ intent: c.intent, say: c.say, ...scoreCommand(c, afterToks) }))
    .sort((a, b) => b.score - a.score);
  const pick = ranked.find((c) => c.score >= FUZZY_MIN && (!valid || valid.has(c.intent)));
  if (!pick) {
    // sole-valid-action fallback: if the timer state leaves exactly ONE plausible
    // timer action and the phrase carries a job word, infer it even when the verb
    // was too garbled to score (e.g. off the clock, "caliper stock job" → start)
    const JOB = /\b(job|jobs|task|work|working|clock|timer|gig)\b/;
    // require a near-miss verb signal (not zero) so a random off-clock sentence that
    // merely contains "job"/"work" doesn't auto-start the timer
    if (valid && JOB.test(after) && ranked[0]?.score >= 0.4) {
      const timerActions = ['start', 'stop', 'done', 'break', 'resume'].filter((i) => valid.has(i));
      if (timerActions.length === 1) {
        return { intent: timerActions[0], heard: after, confidence: 'fuzzy', confirm: true, score: 0 };
      }
    }
    const top = ranked[0];
    return { intent: null, heard: after, suggestion: top && top.score >= 0.45 ? top.intent : null };
  }
  // ANY fuzzy (inferred, not exact) match confirms before acting — inferring a command
  // from a garbled/ambient word ("breaker"→break, "light"→stop) is too collision-prone
  // to act on blind. Only 'status' is read-only enough to run without asking.
  return { intent: pick.intent, heard: after, confidence: 'fuzzy', confirm: pick.intent !== 'status', score: Math.round(pick.score * 100) / 100 };
}
