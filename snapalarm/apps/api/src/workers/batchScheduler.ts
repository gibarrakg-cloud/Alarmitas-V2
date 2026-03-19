import { Queue, Worker, type Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '../prisma';
import { AIProviderService } from '@snapalarm/ai-service';
import { BatchRetryManager } from '@snapalarm/ai-service';
import { ImageProcessor } from '@snapalarm/image-processor';
import type { BatchJob, BatchResult, AIGenerationResult } from '@snapalarm/shared-types';

// ============================================================
// batchScheduler — BullMQ 4-window batch scheduler (UTC)
//
// Windows:
//   BATCH_A: 00:00 UTC → alarms firing 06:00–10:00 UTC
//   BATCH_B: 06:00 UTC → alarms firing 12:00–16:00 UTC
//   BATCH_C: 12:00 UTC → alarms firing 18:00–22:00 UTC
//   BATCH_D: 18:00 UTC → alarms firing 00:00–04:00 UTC
//
// Each window has 6h total processing time for 4h of alarm slots.
// ============================================================

const logger = pino({ name: 'batchScheduler' });

const REDIS_CONNECTION = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] ?? 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':').pop() ?? '6379', 10),
};

// ---- Queue definitions -----------------------------------

export const alarmQueue = new Queue('alarm-generation', {
  connection: REDIS_CONNECTION,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
    attempts: 1, // RetryEngine handles retries internally
  },
});

// Separate queue for scheduled batch triggers
const batchTriggerQueue = new Queue('batch-trigger', {
  connection: REDIS_CONNECTION,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 100 } },
});

// ---- Batch window definitions ----------------------------

interface BatchWindowDef {
  name: 'BATCH_A' | 'BATCH_B' | 'BATCH_C' | 'BATCH_D';
  run_hour_utc: number;   // UTC hour when this batch runs
  covers_start: number;   // UTC hour range start (inclusive)
  covers_end: number;     // UTC hour range end (exclusive)
}

const BATCH_WINDOWS: BatchWindowDef[] = [
  { name: 'BATCH_A', run_hour_utc: 0,  covers_start: 6,  covers_end: 10 },
  { name: 'BATCH_B', run_hour_utc: 6,  covers_start: 12, covers_end: 16 },
  { name: 'BATCH_C', run_hour_utc: 12, covers_start: 18, covers_end: 22 },
  { name: 'BATCH_D', run_hour_utc: 18, covers_start: 0,  covers_end: 4  },
];

// ---- Service instances -----------------------------------

const aiService = new AIProviderService({
  openai_api_key: process.env.OPENAI_API_KEY!,
  anthropic_api_key: process.env.ANTHROPIC_API_KEY!,
  google_ai_api_key: process.env.GOOGLE_AI_API_KEY!,
  xai_api_key: process.env.XAI_API_KEY!,
});

const imageProcessor = new ImageProcessor({
  aws_region: process.env.AWS_REGION!,
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID!,
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY!,
  bucket_private: process.env.S3_BUCKET_PRIVATE!,
  bucket_public: process.env.S3_BUCKET_PUBLIC!,
});

// ---- Alarm generation worker ----------------------------

new Worker(
  'alarm-generation',
  async (job: Job) => {
    const { alarm_id, user_id, original_image_base64, title, reason, humor_level, fire_time_utc } = job.data;

    logger.info({ alarm_id, job_name: job.name }, 'Processing alarm generation job');

    await prisma.alarm.update({
      where: { id: alarm_id },
      data: { generationStatus: 'GENERATING', generationStartedAt: new Date() },
    });

    const deadline_utc = new Date(new Date(fire_time_utc).getTime() - 5 * 60 * 1000); // 5-min before fire

    try {
      // 1. Generate text via AI
      const ai_result = await aiService.generate(
        { image_base64: original_image_base64, alarm_title: title, alarm_reason: reason, humor_level, user_language: 'en' },
        deadline_utc,
      );

      // 2. Composite image with Sharp
      const image_result = await imageProcessor.overlay({
        input_s3_key: `originals/${user_id}/${alarm_id}.jpg`,
        text: ai_result.value.generated_text,
        watermark: false,
      });

      // 3. Save results
      const now = new Date();
      await prisma.$transaction([
        prisma.alarm.update({
          where: { id: alarm_id },
          data: {
            generationStatus: 'COMPLETED',
            generatedText: ai_result.value.generated_text,
            generatedImageS3Key: image_result.output_s3_key,
            generatedImageUrl: image_result.output_url,
            generationCompletedAt: now,
            imageReadyAt: now,
            retryCount: ai_result.attempts - 1,
          },
        }),
        prisma.aIGenerationLog.create({
          data: {
            alarmId: alarm_id,
            modelUsed: ai_result.value.model_used,
            humorLevel: humor_level,
            tokensUsed: ai_result.value.tokens_used,
            costUsd: ai_result.value.cost_usd,
            durationMs: ai_result.value.duration_ms,
            retryCount: ai_result.attempts - 1,
            batchOrSync: job.name === 'batch' ? 'batch' : 'sync',
          },
        }),
      ]);

      logger.info({ alarm_id }, 'Alarm generation completed successfully');
    } catch (err) {
      logger.error({ alarm_id, err }, 'Alarm generation failed — applying static fallback');
      await applyStaticFallback(alarm_id, user_id, title, String(err));
    }
  },
  {
    connection: REDIS_CONNECTION,
    concurrency: 10,
  },
);

// ---- Batch trigger worker --------------------------------

new Worker(
  'batch-trigger',
  async (job: Job) => {
    const { window_name, date_str } = job.data;
    const window_key = `${window_name}_${date_str}`;

    logger.info({ window_key }, 'Batch trigger fired — loading queued alarms');

    const alarms = await prisma.alarm.findMany({
      where: {
        batchWindow: window_key,
        generationStatus: 'QUEUED_FOR_BATCH',
        isActive: true,
      },
      include: {
        user: { select: { language: true } },
      },
    });

    logger.info({ window_key, count: alarms.length }, 'Found alarms to process in batch');

    // Mark all as BATCH_SUBMITTED
    await prisma.alarm.updateMany({
      where: { id: { in: alarms.map((a) => a.id) } },
      data: { generationStatus: 'BATCH_SUBMITTED' },
    });

    // Enqueue each for generation
    const jobs = alarms.map((alarm) => ({
      name: 'batch',
      data: {
        alarm_id: alarm.id,
        user_id: alarm.userId,
        original_image_base64: '', // loaded from S3 in worker
        title: alarm.title,
        reason: alarm.reason,
        humor_level: alarm.humorLevel,
        fire_time_utc: alarm.fireTimeUtc.toISOString(),
      },
      opts: { priority: 10 },
    }));

    await alarmQueue.addBulk(jobs);
    logger.info({ window_key, enqueued: jobs.length }, 'Batch jobs enqueued');
  },
  { connection: REDIS_CONNECTION, concurrency: 1 },
);

// ---- Schedule daily batch triggers ----------------------

export async function scheduleBatchTriggers(date: Date = new Date()): Promise<void> {
  const date_str = date.toISOString().split('T')[0];

  for (const window of BATCH_WINDOWS) {
    const run_time = new Date(`${date_str}T00:00:00.000Z`);
    run_time.setUTCHours(window.run_hour_utc, 0, 0, 0);

    const delay_ms = run_time.getTime() - Date.now();
    if (delay_ms < 0) {
      logger.info({ window: window.name, date_str }, 'Batch window already passed, skipping');
      continue;
    }

    const job_id = `batch-trigger-${window.name}-${date_str}`;
    const existing = await batchTriggerQueue.getJob(job_id);
    if (existing) continue; // Already scheduled

    await batchTriggerQueue.add(
      'trigger',
      { window_name: window.name, date_str },
      { delay: delay_ms, jobId: job_id },
    );

    logger.info({ window: window.name, run_time: run_time.toISOString(), delay_ms }, 'Batch trigger scheduled');
  }
}

// ---- Static fallback -------------------------------------

async function applyStaticFallback(
  alarm_id: string,
  user_id: string,
  alarm_title: string,
  reason: string,
): Promise<void> {
  try {
    const image_result = await imageProcessor.overlayFallback(
      `originals/${user_id}/${alarm_id}.jpg`,
      alarm_title,
    );

    await prisma.alarm.update({
      where: { id: alarm_id },
      data: {
        generationStatus: 'FALLBACK',
        generatedImageS3Key: image_result.output_s3_key,
        generatedImageUrl: image_result.output_url,
        fallbackReason: reason,
        generationCompletedAt: new Date(),
        imageReadyAt: new Date(),
      },
    });

    logger.info({ alarm_id }, 'Static fallback applied successfully');
  } catch (fallback_err) {
    logger.error({ alarm_id, fallback_err }, 'Static fallback also failed — alarm will fire with no image');
    await prisma.alarm.update({
      where: { id: alarm_id },
      data: { generationStatus: 'FAILED', fallbackReason: `fallback_also_failed: ${String(fallback_err)}` },
    });
  }
}
