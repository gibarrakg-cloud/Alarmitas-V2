import type { FailureType, RetryConfig } from '@snapalarm/shared-types';

// ============================================================
// RetryEngine — Exponential backoff with deadline awareness
//
// Usage:
//   const engine = new RetryEngine({ deadline_utc: alarmFireTime });
//   const result = await engine.run(() => callAIProvider(request));
// ============================================================

const DEFAULT_CONFIG: RetryConfig = {
  base_ms: 2000,
  factor: 2,
  max_delay_ms: 1_800_000, // 30 minutes
  max_attempts: 5,
  jitter_ms: 1000,
};

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly failure_type: FailureType,
    public readonly retry_after_ms?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class PermanentError extends Error {
  constructor(
    message: string,
    public readonly status_code?: number,
  ) {
    super(message);
    this.name = 'PermanentError';
  }
}

export interface RetryEngineOptions {
  deadline_utc: Date;
  config?: Partial<RetryConfig>;
  on_attempt_failed?: (attempt: number, error: Error, wait_ms: number) => void;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  total_duration_ms: number;
}

export class RetryEngine {
  private readonly cfg: RetryConfig;
  private readonly deadline_utc: Date;
  private readonly on_attempt_failed?: RetryEngineOptions['on_attempt_failed'];

  constructor(options: RetryEngineOptions) {
    this.cfg = { ...DEFAULT_CONFIG, ...options.config };
    this.deadline_utc = options.deadline_utc;
    this.on_attempt_failed = options.on_attempt_failed;
  }

  // ---- Public API ------------------------------------------

  async run<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    const started_at = Date.now();
    let attempt = 0;

    while (attempt < this.cfg.max_attempts) {
      const time_until_deadline_ms = this.deadline_utc.getTime() - Date.now();

      // Guarantee: if < 60s until deadline, skip all retries and throw
      if (time_until_deadline_ms < 60_000) {
        throw new Error(
          `RetryEngine: deadline too close (${Math.round(time_until_deadline_ms / 1000)}s remaining). Aborting to allow static fallback.`,
        );
      }

      try {
        const value = await fn();
        return {
          value,
          attempts: attempt + 1,
          total_duration_ms: Date.now() - started_at,
        };
      } catch (err) {
        attempt++;
        const error = err instanceof Error ? err : new Error(String(err));

        // Permanent errors: skip retries immediately
        if (err instanceof PermanentError) {
          throw err;
        }

        if (attempt >= this.cfg.max_attempts) {
          throw error;
        }

        const wait_ms = this.calculateWait(attempt, err);
        const time_left_ms = this.deadline_utc.getTime() - Date.now() - 120_000; // keep 2min buffer

        // Never wait longer than time available before deadline
        const safe_wait_ms = Math.min(wait_ms, Math.max(0, time_left_ms));

        if (this.on_attempt_failed) {
          this.on_attempt_failed(attempt, error, safe_wait_ms);
        }

        if (safe_wait_ms <= 0) {
          // No time left — throw immediately to allow fallback
          throw new Error(
            `RetryEngine: no time left before deadline to wait for retry. Aborting after ${attempt} attempt(s).`,
          );
        }

        await this.sleep(safe_wait_ms);
      }
    }

    // Should never reach here due to throw inside loop, but TypeScript needs it
    throw new Error('RetryEngine: max attempts exhausted');
  }

  // ---- Helpers ---------------------------------------------

  private calculateWait(attempt: number, err: unknown): number {
    // Respect Retry-After header if present (rate limit)
    if (err instanceof RetryableError && err.failure_type === 'RATE_LIMIT' && err.retry_after_ms) {
      return Math.min(err.retry_after_ms, this.cfg.max_delay_ms);
    }

    const jitter = Math.random() * this.cfg.jitter_ms;
    const exponential = this.cfg.base_ms * Math.pow(this.cfg.factor, attempt - 1);
    return Math.min(exponential + jitter, this.cfg.max_delay_ms);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---- HTTP error classifier --------------------------------

export function classifyHttpError(status: number, message?: string): FailureType {
  if (status === 429) return 'RATE_LIMIT';
  if ([400, 401, 403, 422].includes(status)) return 'PERMANENT';
  if ([500, 502, 503, 504].includes(status)) return 'TRANSIENT';
  if (message && /ETIMEDOUT|ECONNABORTED|ECONNRESET/.test(message)) return 'TIMEOUT';
  return 'TRANSIENT';
}

export function buildRetryableError(status: number, message: string, retry_after_header?: string): Error {
  const type = classifyHttpError(status, message);

  if (type === 'PERMANENT') {
    return new PermanentError(`HTTP ${status}: ${message}`, status);
  }

  const retry_after_ms = retry_after_header ? parseInt(retry_after_header, 10) * 1000 : undefined;
  return new RetryableError(`HTTP ${status}: ${message}`, type, retry_after_ms);
}
