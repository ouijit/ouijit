import { describe, test, expect } from 'vitest';
import {
  describeSchedule,
  lastRun,
  nextRun,
  parseCron,
  scheduleFromText,
  validateSchedule,
} from '../automations/schedule';

const at = (s: string) => new Date(s);

describe('automation schedules', () => {
  test('presets read as cron and back as the words they came from', () => {
    const cases: [string, string | null, string][] = [
      ['hourly', '0 * * * *', 'Hourly'],
      ['daily 09:30', '30 9 * * *', 'Daily at 09:30'],
      ['weekdays 9:00', '0 9 * * 1-5', 'Weekdays at 09:00'],
      ['weekly Monday 18:05', '5 18 * * 1', 'Mondays at 18:05'],
      ['manual', null, 'Manual'],
      ['*/30 8-17 * * 1-5', '*/30 8-17 * * 1-5', '*/30 8-17 * * 1-5'],
    ];
    for (const [text, cron, words] of cases) {
      expect(scheduleFromText(text)).toBe(cron);
      expect(describeSchedule(cron)).toBe(words);
    }
    expect(() => scheduleFromText('daily')).toThrow(/time like 09:00/);
    expect(() => scheduleFromText('weekly someday 09:00')).toThrow(/day like mon/);
  });

  test('next and last runs walk local time, including the weekday and day-of-month rules', () => {
    // Friday 17:00 → the next weekday 09:00 is Monday.
    expect(nextRun('0 9 * * 1-5', at('2026-11-13T17:00:00'))).toEqual(at('2026-11-16T09:00:00'));
    // Strictly after: at 09:00 exactly, the next is tomorrow.
    expect(nextRun('0 9 * * *', at('2026-11-10T09:00:00'))).toEqual(at('2026-11-11T09:00:00'));
    // Both day fields restricted: either matching fires it (the 1st, or any Sunday).
    expect(nextRun('0 0 1 * 0', at('2026-11-10T12:00:00'))).toEqual(at('2026-11-15T00:00:00'));
    // A date that never comes never runs.
    expect(nextRun('0 0 31 2 *', at('2026-01-01T00:00:00'))).toBeNull();

    // Away all weekend: the latest weekday 09:00 missed by Monday 08:00 is Friday's.
    expect(lastRun('0 9 * * 1-5', at('2026-11-16T08:00:00'), at('2026-11-09T08:00:00'))).toEqual(
      at('2026-11-13T09:00:00'),
    );
    expect(lastRun('0 9 * * 1-5', at('2026-11-16T08:00:00'), at('2026-11-14T00:00:00'))).toBeNull();
  });

  test('a schedule must parse, ever fire, and leave at least 15 minutes between runs', () => {
    expect(() => parseCron('0 9 * *')).toThrow(/five fields/);
    expect(() => parseCron('0 25 * * *')).toThrow(/out of range/);
    expect(() => parseCron('0 9 * * mon')).toThrow(/Bad day of week/);
    expect(() => validateSchedule('*/5 * * * *')).toThrow(/every 15 minutes/);
    expect(() => validateSchedule('0,10 9 * * *')).toThrow(/every 15 minutes/);
    expect(() => validateSchedule('0 0 31 2 *')).toThrow(/never runs/);
    expect(() => validateSchedule('*/15 * * * *')).not.toThrow();
    expect(() => validateSchedule('0 9 * * 1-5')).not.toThrow();
  });
});
