import { describe, it, expect } from 'vitest';
import { parseCommand, normalize } from '../voiceCommands.js';

describe('normalize', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalize('Caliper, Stop Job.')).toBe('caliper stop job');
  });
});

describe('parseCommand — wake word gate', () => {
  it('ignores chatter with no wake word', () => {
    expect(parseCommand('stop the job now')).toBe(null);
  });
  it('tolerates a mis-heard wake word ("caliber")', () => {
    expect(parseCommand('caliber start job', { running: false })?.intent).toBe('start');
  });
});

describe('parseCommand — exact phrases (no confirm)', () => {
  it('matches an exact command after the wake word', () => {
    expect(parseCommand('caliper start job', { running: false })).toMatchObject({ intent: 'start', confidence: 'exact', confirm: false });
  });
  it('whole-word match: "breaker" does not fire "break"', () => {
    const r = parseCommand('caliper the breaker tripped', { running: true, onBreak: false });
    expect(r.confidence).not.toBe('exact');
  });
  it('longest-phrase-first: "back to work" resolves to resume, not "work"', () => {
    expect(parseCommand('caliper back to work', { running: true, onBreak: true })).toMatchObject({ intent: 'resume', confidence: 'exact' });
  });
});

describe('parseCommand — fuzzy pass uses timer state and confirms destructive actions', () => {
  it('"stock job" off the clock → start (fuzzy), asks to confirm', () => {
    const r = parseCommand('caliper stock job', { running: false });
    expect(r.intent).toBe('start');
    expect(r.confirm).toBe(true);
    expect(r.confidence).toBe('fuzzy');
  });
  it('a fuzzy destructive match confirms; read-only status does not', () => {
    const stop = parseCommand('caliper stahp', { running: true, onBreak: false });
    if (stop.intent === 'stop') expect(stop.confirm).toBe(true);
    const status = parseCommand('caliper status', { running: true });
    expect(status).toMatchObject({ intent: 'status', confirm: false });
  });
});

describe('parseCommand — yes/no confirmers', () => {
  it('parses confirm and cancel', () => {
    expect(parseCommand('caliper yes')?.intent).toBe('confirm');
    expect(parseCommand('caliper cancel')?.intent).toBe('cancel');
  });
});
