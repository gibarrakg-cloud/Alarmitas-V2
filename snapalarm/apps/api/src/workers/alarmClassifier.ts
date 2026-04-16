import type { AlarmClassification } from '@snapalarm/shared-types';

// ============================================================
// alarmClassifier — Classifies alarms on creation
//
// Rules:
//   >= 6h  → QUEUED_FOR_BATCH   (assign to next eligible batch window)
//   30m–6h → IMMEDIATE_GENERATION (priority BullMQ queue)
//   < 30m  → NO_AI_GENERATION   (static fallback, Sharp only)
//
// All times are UTC.
// ============================================================

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

// Batch windows run at these UTC hours each day
const BATCH_WINDOWS = [
  { name: 'BATCH_A', run_hour: 0,  covers_start: 6,  covers_end: 10 },
  { name: 'BATCH_B', run_hour: 6,  covers_start: 12, covers_end: 16 },
  { name: 'BATCH_C', run_hour: 12, covers_start: 18, covers_end: 22 },
  { name: 'BATCH_D', run_hour: 18, covers_start: 0,  covers_end: 4  },
] as const;

export function classifyAlarm(fire_time_utc: Date, now_utc: Date = new Date()): AlarmClassification {
  const ms_until_fire = fire_time_utc.getTime() - now_utc.getTime();

  if (ms_until_fire < THIRTY_MIN_MS) {
    return { type: 'NO_AI_GENERATION' };
  }

  if (ms_until_fire < SIX_HOURS_MS) {
    return { type: 'IMMEDIATE_GENERATION' };
  }

  // >= 6h → assign to next eligible batch window
  const batch_window = assignBatchWindow(fire_time_utc);
  // If the batch window already ran, generate immediately instead of leaving the alarm stuck
  if (getBatchWindowRunTime(batch_window).getTime() <= now_utc.getTime()) {
    return { type: 'IMMEDIATE_GENERATION' };
  }
  return { type: 'QUEUED_FOR_BATCH', batch_window };
}

// ---- Batch window assignment -----------------------------

function assignBatchWindow(fire_time_utc: Date): string {
  const fire_hour = fire_time_utc.getUTCHours();
  const fire_date_str = toDateStr(fire_time_utc);

  // Find which batch window covers this fire hour
  // BATCH_D covers 0-4 UTC, which is the NEXT day's BATCH_D relative to previous day
  for (const window of BATCH_WINDOWS) {
    if (coversHour(window, fire_hour)) {
      // The batch runs at window.run_hour on the same UTC date as the alarm fires
      // (or previous day for BATCH_D covering next day's 0-4)
      const batch_date = window.name === 'BATCH_D' && fire_hour < 6
        ? previousDay(fire_time_utc)
        : fire_date_str;

      return `${window.name}_${batch_date}`;
    }
  }

  // Fallback: assign to BATCH_A of fire day (shouldn't happen for valid UTC hours)
  return `BATCH_A_${fire_date_str}`;
}

function coversHour(window: (typeof BATCH_WINDOWS)[number], hour: number): boolean {
  if (window.covers_start < window.covers_end) {
    return hour >= window.covers_start && hour < window.covers_end;
  }
  // Wraps midnight (BATCH_D: 0-4)
  return hour >= window.covers_start || hour < window.covers_end;
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

function previousDay(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateStr(d);
}

// ---- Exported helpers for scheduler use -----------------

export function getBatchWindowRunTime(window_key: string): Date {
  // window_key format: "BATCH_A_2024-01-15"
  const [batch_name, date_str] = window_key.split(/_(?=\d{4}-)/);
  const window = BATCH_WINDOWS.find((w) => w.name === batch_name);

  if (!window || !date_str) {
    throw new Error(`Invalid batch window key: ${window_key}`);
  }

  const run_time = new Date(`${date_str}T00:00:00.000Z`);
  run_time.setUTCHours(window.run_hour, 0, 0, 0);
  return run_time;
}

export function getCurrentBatchWindows(): string[] {
  const now = new Date();
  return BATCH_WINDOWS.map((w) => {
    const date_str = w.name === 'BATCH_D' ? previousDay(now) : toDateStr(now);
    return `${w.name}_${date_str}`;
  });
}
