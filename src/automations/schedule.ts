/**
 * Five-field cron (minute hour day-of-month month day-of-week), in local time.
 * Numbers only: `*`, lists, ranges and steps. Sunday is 0.
 */

export const MIN_INTERVAL_MINUTES = 15;

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
] as const;

interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** cron's rule: when both day fields are restricted, either one matching is enough. */
  dayOr: boolean;
}

function parseField(text: string, field: (typeof FIELDS)[number]): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in ${field.name}: ${part}`);
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = field.min;
      hi = field.max;
    } else if (/^\d+-\d+$/.test(range)) {
      [lo, hi] = range.split('-').map(Number);
    } else if (/^\d+$/.test(range)) {
      lo = Number(range);
      hi = stepText === undefined ? lo : field.max;
    } else {
      throw new Error(`Bad ${field.name}: ${part}`);
    }
    if (lo < field.min || hi > field.max || lo > hi) throw new Error(`${field.name} out of range: ${part}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day month weekday');
  const [minutes, hours, days, months, weekdays] = parts.map((p, i) => parseField(p, FIELDS[i]));
  return { minutes, hours, days, months, weekdays, dayOr: parts[2] !== '*' && parts[4] !== '*' };
}

function matches(cron: Cron, d: Date): boolean {
  if (!cron.minutes.has(d.getMinutes()) || !cron.hours.has(d.getHours()) || !cron.months.has(d.getMonth() + 1)) {
    return false;
  }
  const day = cron.days.has(d.getDate());
  const weekday = cron.weekdays.has(d.getDay());
  return cron.dayOr ? day || weekday : day && weekday;
}

const MINUTE = 60_000;
/** Far enough to find any expression that ever fires: Feb 29 can be eight years out. */
const SEARCH_MINUTES = 8 * 366 * 24 * 60;

function startOfMinute(d: Date): Date {
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}

/** The first time strictly after `after` the expression fires, or null if it never does. */
export function nextRun(expr: string, after: Date): Date | null {
  const cron = parseCron(expr);
  const t = startOfMinute(after);
  for (let i = 0; i < SEARCH_MINUTES; i++) {
    t.setTime(t.getTime() + MINUTE);
    if (matches(cron, t)) return new Date(t);
  }
  return null;
}

/** The latest time at or before `at`, and no earlier than `since`, that the expression fired. */
export function lastRun(expr: string, at: Date, since: Date): Date | null {
  const cron = parseCron(expr);
  const t = startOfMinute(at);
  while (t.getTime() >= since.getTime()) {
    if (matches(cron, t)) return new Date(t);
    t.setTime(t.getTime() - MINUTE);
  }
  return null;
}

/** Throws when the expression is invalid, never fires, or fires more often than the minimum. */
export function validateSchedule(expr: string): void {
  let prev = nextRun(expr, new Date());
  if (!prev) throw new Error('That schedule never runs');
  // Two days of runs covers every gap an hour or minute field can make.
  const horizon = prev.getTime() + 2 * 24 * 60 * MINUTE;
  while (prev.getTime() < horizon) {
    const next = nextRun(expr, prev);
    if (!next) return;
    if (next.getTime() - prev.getTime() < MIN_INTERVAL_MINUTES * MINUTE) {
      throw new Error(`Automations run at most every ${MIN_INTERVAL_MINUTES} minutes`);
    }
    prev = next;
  }
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseTime(text: string | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text ?? '');
  if (!m) throw new Error(`Expected a time like 09:00, got ${text ?? 'nothing'}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`Not a time: ${text}`);
  return { hour, minute };
}

/**
 * The schedule a preset names, as cron; null for manual. Accepts `hourly`,
 * `daily 09:00`, `weekdays 09:00`, `weekly mon 09:00`, `manual`, or a cron
 * expression.
 */
export function scheduleFromText(text: string): string | null {
  const words = text.trim().toLowerCase().split(/\s+/);
  switch (words[0]) {
    case 'manual':
      return null;
    case 'hourly':
      return '0 * * * *';
    case 'daily': {
      const { hour, minute } = parseTime(words[1]);
      return `${minute} ${hour} * * *`;
    }
    case 'weekdays': {
      const { hour, minute } = parseTime(words[1]);
      return `${minute} ${hour} * * 1-5`;
    }
    case 'weekly': {
      const day = WEEKDAYS.indexOf((words[1] ?? '').slice(0, 3));
      if (day < 0) throw new Error(`Expected a day like mon, got ${words[1] ?? 'nothing'}`);
      const { hour, minute } = parseTime(words[2]);
      return `${minute} ${hour} * * ${day}`;
    }
  }
  validateSchedule(text);
  return text.trim();
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A preset's own words for its cron, or the cron itself. */
export function describeSchedule(expr: string | null): string {
  if (expr === null) return 'Manual';
  const parts = expr.split(/\s+/);
  const [minute, hour, day, month, weekday] = parts;
  if (expr === '0 * * * *') return 'Hourly';
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*') {
    const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
    if (weekday === '*') return `Daily at ${time}`;
    if (weekday === '1-5') return `Weekdays at ${time}`;
    if (/^\d$/.test(weekday)) return `${DAY_NAMES[Number(weekday)]}s at ${time}`;
  }
  return expr;
}
