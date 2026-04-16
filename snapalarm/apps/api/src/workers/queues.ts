import { Queue } from 'bullmq';

const _redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');

export const REDIS_CONNECTION = {
  host: _redisUrl.hostname,
  port: parseInt(_redisUrl.port || '6379', 10),
  password: _redisUrl.password || undefined,
};

export const alarmQueue = new Queue('alarm-generation', {
  connection: REDIS_CONNECTION,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
    attempts: 1,
  },
});

export const batchTriggerQueue = new Queue('batch-trigger', {
  connection: REDIS_CONNECTION,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 100 } },
});

export const fallbackQueue = new Queue('alarm-fallback', {
  connection: REDIS_CONNECTION,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
    attempts: 1,
  },
});
