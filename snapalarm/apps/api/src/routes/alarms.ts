import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma';
import { classifyAlarm } from '../workers/alarmClassifier';
import { alarmQueue } from '../workers/batchScheduler';
import { computeNextRepeatingOccurrenceUtc } from '../utils/alarmSchedule';
import type { CreateAlarmRequest, AlarmResponse, JwtPayload, AlarmWeekday } from '@snapalarm/shared-types';

// ============================================================
// Alarm routes
//   GET  /alarms
//   GET  /alarms/:id
//   POST /alarms
//   DELETE /alarms/:id
// ============================================================

const CreateAlarmSchema = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  humor_level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  fire_time_utc: z.string().datetime().optional(),
  timezone_source: z.string(),
  mode: z.enum(['IMAGE_ONLY', 'IMAGE_WITH_AUDIO']),
  schedule_type: z.enum(['ONE_TIME', 'REPEATING']),
  repeat_days: z.array(z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ])).optional(),
  local_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  original_image_base64: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.schedule_type === 'ONE_TIME' && !value.fire_time_utc) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fire_time_utc'],
      message: 'fire_time_utc is required for one-time alarms',
    });
  }

  if (value.schedule_type === 'REPEATING') {
    if (!value.local_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['local_time'],
        message: 'local_time is required for repeating alarms',
      });
    }

    if (!value.repeat_days?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repeat_days'],
        message: 'repeat_days must contain at least one weekday',
      });
    }
  }
});

export async function alarmRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // ---- GET /alarms ----------------------------------------

  app.get('/', { onRequest: [authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as JwtPayload;

    const alarms = await prisma.alarm.findMany({
      where: { userId, isActive: true },
      orderBy: { fireTimeUtc: 'asc' },
      select: {
        id: true, title: true, reason: true, humorLevel: true,
        fireTimeUtc: true, scheduleType: true, repeatDays: true, localTime: true, timezoneSource: true,
        mode: true, generationStatus: true,
        generatedImageUrl: true, generatedAudioUrl: true, generatedText: true,
        isActive: true, createdAt: true,
      },
    });

    const responses = alarms
      .map(toAlarmResponse)
      .sort((a, b) => new Date(a.fire_time_utc).getTime() - new Date(b.fire_time_utc).getTime());

    return reply.send(responses);
  });

  // ---- GET /alarms/:id ------------------------------------

  app.get<{ Params: { id: string } }>('/:id', { onRequest: [authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as JwtPayload;
    const alarm = await prisma.alarm.findFirst({
      where: { id: request.params.id, userId },
    });

    if (!alarm) return reply.status(404).send({ error: 'Alarm not found' });
    return reply.send(toAlarmResponse(alarm));
  });

  // ---- POST /alarms ---------------------------------------

  app.post<{ Body: CreateAlarmRequest }>('/', { onRequest: [authenticate] }, async (request, reply) => {
    const { sub: userId, tier } = request.user as JwtPayload;

    const parsed = CreateAlarmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const {
      title,
      reason,
      humor_level,
      fire_time_utc,
      timezone_source,
      mode,
      schedule_type,
      repeat_days,
      local_time,
      original_image_base64,
    } = parsed.data;

    // Check credit balance for FREE/BASIC tiers
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    if (tier !== 'PRO' && user.credits <= 0) {
      return reply.status(402).send({ error: 'Insufficient credits', code: 'NO_CREDITS' });
    }

    // Upload original image to S3 (returns S3 key)
    const original_s3_key = `originals/${userId}/${Date.now()}.jpg`;
    // NOTE: actual S3 upload delegated to alarmFallbackWorker / generation pipeline
    // Here we store the key and will process async

    const fireTimeUtc = schedule_type === 'REPEATING'
      ? computeNextRepeatingOccurrenceUtc(
          [...new Set((repeat_days ?? []).slice().sort((a, b) => a - b))] as AlarmWeekday[],
          local_time!,
          timezone_source,
        )
      : new Date(fire_time_utc!);
    const classification = classifyAlarm(fireTimeUtc);

    const alarm = await prisma.alarm.create({
      data: {
        userId,
        title,
        reason,
        humorLevel: humor_level,
        fireTimeUtc,
        scheduleType: schedule_type,
        repeatDays: schedule_type === 'REPEATING'
          ? [...new Set((repeat_days ?? []).slice().sort((a, b) => a - b))]
          : [],
        localTime: schedule_type === 'REPEATING' ? local_time! : null,
        timezoneSource: timezone_source,
        mode,
        originalImageS3Key: original_s3_key,
        generationStatus: classification.type === 'QUEUED_FOR_BATCH'
          ? 'QUEUED_FOR_BATCH'
          : classification.type === 'IMMEDIATE_GENERATION'
          ? 'PENDING'
          : 'PENDING',
        batchWindow: classification.type === 'QUEUED_FOR_BATCH' ? classification.batch_window : null,
      },
    });

    // Deduct credit (not for PRO)
    if (tier !== 'PRO') {
      await prisma.user.update({ where: { id: userId }, data: { credits: { decrement: 1 } } });
    }

    // Enqueue generation job
    await alarmQueue.add(
      classification.type === 'IMMEDIATE_GENERATION' ? 'immediate' : 'batch',
      {
        alarm_id: alarm.id,
        user_id: userId,
        original_image_base64,
        title,
        reason,
        humor_level,
        fire_time_utc: fireTimeUtc.toISOString(),
        classification_type: classification.type,
      },
      {
        priority: classification.type === 'IMMEDIATE_GENERATION' ? 1 : 10,
        delay: 0,
      },
    );

    return reply.status(201).send(toAlarmResponse(alarm));
  });

  // ---- DELETE /alarms/:id ---------------------------------

  app.delete<{ Params: { id: string } }>('/:id', { onRequest: [authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as JwtPayload;

    const alarm = await prisma.alarm.findFirst({ where: { id: request.params.id, userId } });
    if (!alarm) return reply.status(404).send({ error: 'Alarm not found' });

    if (['BATCH_SUBMITTED', 'GENERATING'].includes(alarm.generationStatus)) {
      // Allow cancel but mark as CANCELLED — batch may already be in progress
      await prisma.alarm.update({
        where: { id: alarm.id },
        data: { generationStatus: 'CANCELLED', isActive: false },
      });
    } else if (alarm.generationStatus === 'QUEUED_FOR_BATCH') {
      // Refund 1 credit if cancelling before batch starts
      await prisma.$transaction([
        prisma.alarm.update({ where: { id: alarm.id }, data: { generationStatus: 'CANCELLED', isActive: false } }),
        prisma.user.update({ where: { id: userId }, data: { credits: { increment: 1 } } }),
      ]);
    } else {
      await prisma.alarm.update({ where: { id: alarm.id }, data: { isActive: false } });
    }

    return reply.send({ ok: true });
  });
}

// ---- Response mapper -------------------------------------

function toAlarmResponse(alarm: any): AlarmResponse {
  const effectiveFireTimeUtc = alarm.scheduleType === 'REPEATING'
    ? computeNextRepeatingOccurrenceUtc(
        (alarm.repeatDays ?? []) as AlarmWeekday[],
        alarm.localTime,
        alarm.timezoneSource,
      )
    : alarm.fireTimeUtc;

  return {
    id: alarm.id,
    title: alarm.title,
    reason: alarm.reason,
    humor_level: alarm.humorLevel,
    fire_time_utc: effectiveFireTimeUtc.toISOString(),
    schedule_type: alarm.scheduleType,
    repeat_days: (alarm.repeatDays ?? []) as AlarmWeekday[],
    local_time: alarm.localTime ?? null,
    mode: alarm.mode,
    generation_status: alarm.generationStatus,
    generated_image_url: alarm.generatedImageUrl ?? null,
    generated_audio_url: alarm.generatedAudioUrl ?? null,
    generated_text: alarm.generatedText ?? null,
    is_active: alarm.isActive,
    created_at: alarm.createdAt.toISOString(),
  };
}
