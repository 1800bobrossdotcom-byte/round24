import { describe, it, expect } from 'vitest';
import { parseCommand, normalize } from '../voiceCommands.js';

describe('normalize', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalize('Round 24, Stop Job.')).toBe('round24 stop job');
    expect(normalize('round twenty-four, start job')).toBe('round24 start job');
    expect(normalize('Round twenty four status')).toBe('round24 status');
  });
});

describe('parseCommand — wake word gate', () => {
  it('ignores chatter with no wake word', () => {
    expect(parseCommand('stop the job now')).toBe(null);
  });
  it('tolerates a mis-heard wake phrase ("around 24", "ground twenty four")', () => {
    expect(parseCommand('around 24 start job', { running: false })?.intent).toBe('start');
    expect(parseCommand('ground twenty four start job', { running: false })?.intent).toBe('start');
  });
  it('a bare "24" or "round" alone is not the wake phrase', () => {
    expect(parseCommand('24 start job')).toBe(null);
    expect(parseCommand('round start job')).toBe(null);
  });
});

describe('parseCommand — exact phrases (no confirm)', () => {
  it('matches an exact command after the wake word', () => {
    expect(parseCommand('round 24 start job', { running: false })).toMatchObject({ intent: 'start', confidence: 'exact', confirm: false });
  });
  it('whole-word match: "breaker" does not fire "break"', () => {
    const r = parseCommand('round 24 the breaker tripped', { running: true, onBreak: false });
    expect(r.confidence).not.toBe('exact');
  });
  it('longest-phrase-first: "back to work" resolves to resume, not "work"', () => {
    expect(parseCommand('round 24 back to work', { running: true, onBreak: true })).toMatchObject({ intent: 'resume', confidence: 'exact' });
  });
});

describe('parseCommand — fuzzy pass uses timer state and confirms destructive actions', () => {
  it('"stock job" off the clock → start (fuzzy), asks to confirm', () => {
    const r = parseCommand('round 24 stock job', { running: false });
    expect(r.intent).toBe('start');
    expect(r.confirm).toBe(true);
    expect(r.confidence).toBe('fuzzy');
  });
  it('a fuzzy destructive match confirms; read-only status does not', () => {
    const stop = parseCommand('round 24 stahp', { running: true, onBreak: false });
    if (stop.intent === 'stop') expect(stop.confirm).toBe(true);
    const status = parseCommand('round 24 status', { running: true });
    expect(status).toMatchObject({ intent: 'status', confirm: false });
  });
});

describe('parseCommand — yes/no confirmers', () => {
  it('parses confirm and cancel', () => {
    expect(parseCommand('round 24 yes')?.intent).toBe('confirm');
    expect(parseCommand('round 24 cancel')?.intent).toBe('cancel');
  });
});
