-- Add support for one-time vs repeating alarms

CREATE TYPE "ScheduleType" AS ENUM ('ONE_TIME', 'REPEATING');

ALTER TABLE "Alarm"
ADD COLUMN "scheduleType" "ScheduleType" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN "repeatDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "localTime" TEXT;
