import { describe, it, expect } from 'vitest';
import { bookingsOverlap, isSlotFree, sortBookings, bookingSummary } from '../amenity.js';

describe('bookingsOverlap', () => {
  it('overlapping windows conflict', () => {
    expect(bookingsOverlap({ startTime: '10:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' })).toBe(true);
  });
  it('adjacent windows do not (half-open)', () => {
    expect(bookingsOverlap({ startTime: '10:00', endTime: '12:00' }, { startTime: '12:00', endTime: '13:00' })).toBe(false);
  });
  it('a whole-day hold (no times) blocks anything that day', () => {
    expect(bookingsOverlap({ startTime: null, endTime: null }, { startTime: '09:00', endTime: '10:00' })).toBe(true);
  });
});

describe('isSlotFree', () => {
  const existing = [
    { id: 'b1', amenityId: 'a1', date: '2026-08-01', startTime: '10:00', endTime: '12:00', status: 'confirmed' },
    { id: 'b2', amenityId: 'a1', date: '2026-08-01', startTime: '13:00', endTime: '14:00', status: 'pending' },
  ];
  it('blocks a clash with a CONFIRMED booking', () => {
    expect(isSlotFree({ id: 'new', amenityId: 'a1', date: '2026-08-01', startTime: '11:00', endTime: '11:30' }, existing)).toBe(false);
  });
  it('pending bookings do not block (office decides)', () => {
    expect(isSlotFree({ id: 'new', amenityId: 'a1', date: '2026-08-01', startTime: '13:15', endTime: '13:45' }, existing)).toBe(true);
  });
  it('free on a different amenity or day', () => {
    expect(isSlotFree({ id: 'new', amenityId: 'a2', date: '2026-08-01', startTime: '10:30', endTime: '11:00' }, existing)).toBe(true);
    expect(isSlotFree({ id: 'new', amenityId: 'a1', date: '2026-08-02', startTime: '10:30', endTime: '11:00' }, existing)).toBe(true);
  });
  it('does not conflict with itself', () => {
    expect(isSlotFree({ id: 'b1', amenityId: 'a1', date: '2026-08-01', startTime: '10:00', endTime: '12:00' }, existing)).toBe(true);
  });
});

describe('sortBookings', () => {
  it('orders by date then start time', () => {
    const out = sortBookings([
      { date: '2026-08-02', startTime: '09:00' },
      { date: '2026-08-01', startTime: '15:00' },
      { date: '2026-08-01', startTime: '08:00' },
    ]);
    expect(out.map((b) => `${b.date} ${b.startTime}`)).toEqual(['2026-08-01 08:00', '2026-08-01 15:00', '2026-08-02 09:00']);
  });
});

describe('bookingSummary', () => {
  const bookings = [
    { date: '2026-08-01', status: 'pending' },
    { date: '2026-08-02', status: 'confirmed' },
    { date: '2026-06-01', status: 'confirmed' }, // past
    { date: '2026-08-03', status: 'declined' },
  ];
  it('counts pending and upcoming-confirmed relative to today', () => {
    const s = bookingSummary(bookings, '2026-07-15');
    expect(s.pending).toBe(1);
    expect(s.confirmedUpcoming).toBe(1); // the Aug 2 one; June is past, declined excluded
  });
});
