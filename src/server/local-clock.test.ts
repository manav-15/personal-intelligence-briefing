import { describe, expect, it } from 'vitest';
import { isScheduledTimeReached, localClock, localDate } from './local-clock';

const kolkata = { localTime: '08:00', timezone: 'Asia/Kolkata' };

describe('local clock', () => {
  it('uses the Asia/Kolkata calendar date, not UTC', () => {
    expect(localDate(new Date('2026-09-18T20:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-09-19',
    );
    expect(localDate(new Date('2026-09-18T12:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-09-18',
    );
  });

  it('treats 08:00 Asia/Kolkata as 02:30 UTC', () => {
    expect(
      localClock(new Date('2026-09-21T02:30:00Z'), 'Asia/Kolkata'),
    ).toEqual({ date: '2026-09-21', minutes: 8 * 60 });
  });
});

describe('scheduled due window', () => {
  it('is not due before the local time on that date', () => {
    expect(
      isScheduledTimeReached(new Date('2026-09-21T02:29:00Z'), kolkata),
    ).toEqual({ due: false, date: '2026-09-21' });
  });

  it('becomes due at the local time and stays due until local midnight', () => {
    expect(
      isScheduledTimeReached(new Date('2026-09-21T02:30:00Z'), kolkata),
    ).toEqual({ due: true, date: '2026-09-21' });
    expect(
      isScheduledTimeReached(new Date('2026-09-21T18:29:00Z'), kolkata),
    ).toEqual({ due: true, date: '2026-09-21' });
  });

  it('opens a new date after local midnight instead of catching up overnight', () => {
    expect(
      isScheduledTimeReached(new Date('2026-09-21T18:30:00Z'), kolkata),
    ).toEqual({ due: false, date: '2026-09-22' });
  });

  it('follows a changed timezone instead of a fixed UTC offset', () => {
    expect(
      isScheduledTimeReached(new Date('2026-09-21T08:00:00Z'), {
        localTime: '08:00',
        timezone: 'UTC',
      }),
    ).toEqual({ due: true, date: '2026-09-21' });
    expect(
      isScheduledTimeReached(new Date('2026-09-21T08:00:00Z'), kolkata),
    ).toEqual({ due: true, date: '2026-09-21' });
  });
});
