import pino from 'pino';
import type { BatchJob, BatchResult, AIGenerationResult } from '@snapalarm/shared-types';
import { RetryEngine, PermanentError } from '@snapalarm/retry-engine';
import { AIProviderService } from './AIProviderService';

// ============================================================
// BatchRetryManager — Handles partial batch failure retries
//
// After a batch completes:
//   - Succeeded jobs → save results
//   - Failed jobs    → retry individually (max CONCURRENCY workers)
//   - Deadline passed or all retries fail → static fallback
// ============================================================

const logger = pino({ name: 'BatchRetryManager' });

const CONCURRENCY = 5; // Max concurrent individual retries to avoid provider rate limits

export interface BatchRetryOptions {
  ai_service: AIProviderService;
  on_result: (alarm_id: string, result: AIGenerationResult) => Promise<void>;
  on_fallback: (alarm_id: string, reason: string) => Promise<void>;
}

export class BatchRetryManager {
  constructor(private readonly opts: BatchRetryOptions) {}

  // ---- Process completed batch results --------------------

  async processBatchResults(results: BatchResult[]): Promise<void> {
    const succeeded = results.filter((r) => r.success && r.result);
    const failed = results.filter((r) => !r.success);

    // Save succeeded results immediately
    await Promise.all(
      succeeded.map((r) =>
        this.opts.on_result(r.alarm_id, r.result!).catch((err) => {
          logger.error({ alarm_id: r.alarm_id, err }, 'Failed to save succeeded batch result');
        }),
      ),
    );

    logger.info({ succeeded: succeeded.length, failed: failed.length }, 'Batch results split');

    if (failed.length === 0) return;

    // Retry failed jobs with controlled concurrency
    await this.retryWithConcurrency(failed, CONCURRENCY);
  }

  // ---- Controlled concurrent retry -------------------------

  private async retryWithConcurrency(jobs: BatchResult[], concurrency: number): Promise<void> {
    // Pull full job details — BatchResult only has alarm_id and error;
    // caller must have loaded job details before calling processBatchResults.
    // We work with what we have and delegate to the retry fn below.
    const queue = [...jobs];
    const inFlight = new Set<Promise<void>>();

    const runNext = () => {
      if (queue.length === 0) return;
      const job = queue.shift()!;
      const p = this.retryFailedJob(job)
        .catch((err) => {
          logger.error({ alarm_id: job.alarm_id, err }, 'RetryFailedJob threw unexpectedly');
        })
        .finally(() => {
          inFlight.delete(p);
          if (queue.length > 0) runNext();
        });
      inFlight.add(p);
    };

    // Seed initial workers
    for (let i = 0; i < Math.min(concurrency, jobs.length); i++) {
      runNext();
    }

    // Wait for all in-flight
    while (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  // ---- Retry a single failed job ---------------------------

  private async retryFailedJob(failedResult: BatchResult & { job?: BatchJob }): Promise<void> {
    const { alarm_id, job } = failedResult;

    if (!job) {
      // No job data available to retry — go directly to fallback
      logger.warn({ alarm_id }, 'No job data for retry, going to static fallback');
      await this.opts.on_fallback(alarm_id, 'no_job_data_for_retry');
      return;
    }

    const now = Date.now();
    const ms_until_deadline = job.deadline_utc.getTime() - now;

    // If deadline already passed or < 5 minutes left — fallback immediately
    if (ms_until_deadline < 5 * 60_000) {
      logger.warn({ alarm_id, ms_until_deadline }, 'Deadline too close, going to static fallback');
      await this.opts.on_fallback(alarm_id, 'deadline_too_close');
      return;
    }

    const engine = new RetryEngine({
      deadline_utc: job.deadline_utc,
      on_attempt_failed: (attempt, error, wait_ms) => {
        logger.warn({ alarm_id, attempt, error: error.message, wait_ms }, 'Individual retry attempt failed');
      },
    });

    try {
      const result = await engine.run(() =>
        this.opts.ai_service.generate(job.request, job.deadline_utc),
      );
      await this.opts.on_result(alarm_id, result.value);
      logger.info({ alarm_id, attempts: result.attempts }, 'Individual retry succeeded');
    } catch (err) {
      const reason =
        err instanceof PermanentError
          ? `permanent_error_${err.status_code ?? 'unknown'}`
          : 'max_retries_exhausted';
      logger.error({ alarm_id, reason }, 'Individual retry failed, applying static fallback');
      await this.opts.on_fallback(alarm_id, reason);
    }
  }
}

// ---- Static fallback image text ---------------------------
// Used by alarmFallbackWorker — just plain alarm title as text

export function buildFallbackText(alarm_title: string): string {
  return alarm_title;
}
