import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '../prisma';
import { ImageProcessor } from '@snapalarm/image-processor';

// ============================================================
// alarmFallbackWorker — Guaranteed static fallback for
// alarms that miss AI generation deadline
//
// Triggered by:
//   1. Deadline monitor detecting alarms still PENDING at T-5min
//   2. BatchRetryManager exhausting all retries
// ============================================================

const logger = pino({ name: 'alarmFallbackWorker' });

const REDIS_CONNECTION = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] ?? 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':').pop() ?? '6379', 10),
};

const imageProcessor = new ImageProcessor({
  aws_region: process.env.AWS_REGION!,
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID!,
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY!,
  bucket_private: process.env.S3_BUCKET_PRIVATE!,
  bucket_public: process.env.S3_BUCKET_PUBLIC!,
});

new Worker(
  'alarm-fallback',
  async (job: Job) => {
    const { alarm_id, fallback_reason } = job.data as { alarm_id: string; fallback_reason: string };

    logger.warn({ alarm_id, fallback_reason }, 'Processing static fallback for alarm');

    const alarm = await prisma.alarm.findUnique({
      where: { id: alarm_id },
      select: { id: true, userId: true, title: true, generationStatus: true, originalImageS3Key: true },
    });

    if (!alarm) {
      logger.error({ alarm_id }, 'Alarm not found for fallback — skipping');
      return;
    }

    if (alarm.generationStatus === 'COMPLETED') {
      logger.info({ alarm_id }, 'Alarm already completed before fallback worker ran — skipping');
      return;
    }

    try {
      const image_result = await imageProcessor.overlayFallback(
        alarm.originalImageS3Key,
        alarm.title,
      );

      await prisma.alarm.update({
        where: { id: alarm_id },
        data: {
          generationStatus: 'FALLBACK',
          generatedImageS3Key: image_result.output_s3_key,
          generatedImageUrl: image_result.output_url,
          fallbackReason: fallback_reason,
          generationCompletedAt: new Date(),
          imageReadyAt: new Date(),
        },
      });

      logger.info({ alarm_id }, 'Static fallback completed');
    } catch (err) {
      logger.error({ alarm_id, err }, 'Static fallback image generation failed');
      // Last resort: mark FAILED but alarm MUST still fire via push notification
      await prisma.alarm.update({
        where: { id: alarm_id },
        data: {
          generationStatus: 'FAILED',
          fallbackReason: `sharp_fallback_failed: ${String(err)}`,
        },
      });
    }
  },
  { connection: REDIS_CONNECTION, concurrency: 20 },
);

logger.info('alarmFallbackWorker started');
