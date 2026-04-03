import type { AlarmWeekday } from '@snapalarm/shared-types';

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  dateTimeFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getLocalParts(date: Date, timeZone: string): LocalDateParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const parts = getLocalParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function parseLocalTime(localTime: string): { hour: number; minute: number } {
  const [hour, minute] = localTime.split(':').map(Number);
  return { hour, minute };
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function toUtcFromLocalDateTime(date: Date, localTime: string, timeZone: string): Date {
  const { hour, minute } = parseLocalTime(localTime);
  const localTimestamp = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );

  let utcTimestamp = localTimestamp - getOffsetMs(new Date(localTimestamp), timeZone);
  const refinedOffset = getOffsetMs(new Date(utcTimestamp), timeZone);
  utcTimestamp = localTimestamp - refinedOffset;

  return new Date(utcTimestamp);
}

export function computeNextRepeatingOccurrenceUtc(
  repeatDays: AlarmWeekday[],
  localTime: string,
  timeZone: string,
  now: Date = new Date(),
): Date {
  const localNow = getLocalParts(now, timeZone);
  const localToday = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));

  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDate = addDays(localToday, offset);
    const weekday = candidateDate.getUTCDay() as AlarmWeekday;
    if (!repeatDays.includes(weekday)) continue;

    const candidateUtc = toUtcFromLocalDateTime(candidateDate, localTime, timeZone);
    if (candidateUtc.getTime() > now.getTime()) {
      return candidateUtc;
    }
  }

  throw new Error('Could not compute next repeating occurrence');
}
