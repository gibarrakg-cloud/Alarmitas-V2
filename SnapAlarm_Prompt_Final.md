# SNAPALARM — MASTER PROMPT v1.0
> Prompt completo y unificado para Claude Opus 4.6
> Incluye: Arquitectura, Bulk Generation, Retry Logic, Monetización, Community Pool

---

## MISSION

You are a senior fullstack engineer and AI specialist with 20+ years of experience.
Your task is to architect and scaffold a complete, production-ready mobile application
called **SnapAlarm**. This is a humor-driven AI alarm/reminder app that generates
personalized images using AI models calibrated by humor level.

Deliver structured, modular, well-commented code and clear architectural decisions
at every step. Do not summarize — write actual, runnable code.

---

## APP CONCEPT

Users create alarms/reminders linked to a photo from their device. When the alarm
fires, the app displays an AI-modified version of that photo with a humor-calibrated
text overlay — optionally read aloud via TTS.

**Core UX Example:**
> User "Rodrigo" sets a gym reminder. He selects "Black Humor" (Level 4).
> The app sends his selfie + alarm context to Grok-2 → generates overlay text:
> *"Come on little piggy, that fat won't burn itself."*
> At alarm time: his photo appears with this text burned in. Optional: TTS reads it aloud.

---

## TECHNICAL STACK

### Platform
- **React Native** with **Expo SDK 51+** (managed workflow)
- Target: iOS 16+ and Android 13+
- Language: **TypeScript** (strict mode)

### Backend
- **Node.js + Fastify** (REST API)
- **PostgreSQL** with **Prisma ORM**
- **Redis** for job queuing and scheduling state
- **BullMQ** for async image generation queues and batch orchestration
- **AWS S3** (or Cloudflare R2) for image and audio storage
- **Docker + docker-compose** for local development environment

### AI Integration Layer (modular, swappable)
Build an `AIProviderService` with a unified interface. Each humor level maps to a
specific model:

- **Level 1 — "Clean / Family-Friendly"** → OpenAI GPT-4o
  - Prompt style: warm, encouraging, wholesome, appropriate for all ages
- **Level 2 — "Intellectual / Ironic"** → Anthropic Claude Sonnet
  - Prompt style: dry wit, cultural references, sophisticated wordplay, subtle sarcasm
- **Level 3 — "Sarcastic / Edgy"** → Google Gemini 1.5 Pro
  - Prompt style: sharp sarcasm, self-deprecating humor, bold observations
- **Level 4 — "Black Humor"** → xAI Grok-2 *(mandatory, non-negotiable)*
  - Prompt style: no-filter dark comedy, brutal honesty, shock value within legal limits

The `AIProviderService` must:
- Accept: `{ image_base64, alarm_title, alarm_reason, humor_level, user_language }`
- Return: `{ generated_text: string, model_used: string, tokens_used: number }`
- Handle rate limits and fallbacks gracefully
- Log all AI interactions for moderation audit
- Never include user PII in prompts sent to third-party APIs

### Image Processing
- **Sharp** (server-side) for text overlay compositing
- Font rendering with proper line breaks, shadows, and responsive sizing
- Output: JPEG optimized for mobile display (~800x800px)
- Preserve original image in S3; store generated version separately
- Fallback static images generated via Sharp only (no AI dependency)

### Text-to-Speech (TTS)
- Primary: **ElevenLabs API** for high-quality TTS
- Fallback: **Google Cloud TTS**
- Cache generated audio files in S3 keyed by `hash(text + voice_id)`

### Notifications & Alarm System
- **Expo Notifications** for push notification scheduling
- **react-native-alarm-manager** (Android precise alarms)
- **BGTaskScheduler** bridged via Expo DevClient (iOS)
- Alarm payload must carry: `generated_image_url`, `audio_url` (optional), `alarm_id`
- Full-screen notification intent on Android; rich notification on iOS

### Calendar Integration
- **Expo Calendar** API for read/write access
- Allow importing existing calendar events as alarm sources
- Write back completed alarms to calendar with generated image attached as note

### Gallery / Photo Access
- **Expo ImagePicker** and **Expo MediaLibrary**
- **SnapAlarm Folder** feature: a dedicated album the app monitors exclusively
  - If enabled in settings: ONLY pull photos from this folder, ignore full gallery
  - If disabled: full gallery access granted
- Photo selection UI with preview and crop functionality

---

## PROJECT STRUCTURE (Monorepo)

```
/snapalarm
  /apps
    /mobile               # React Native / Expo app
    /api                  # Fastify backend
  /packages
    /shared-types         # Shared TypeScript interfaces
    /ai-service           # Unified AI provider module
    /image-processor      # Sharp-based image compositing
    /retry-engine         # Exponential backoff core module
  /infra
    /docker
    /migrations
```

---

## BULK GENERATION STRATEGY & COST OPTIMIZATION

### Core Rules
1. All AI image generation and TTS audio must be completed **minimum 5 minutes**
   before alarm fire time.
2. All alarm times must be stored and processed in **UTC**. Convert to local time
   only at the display layer.
3. Target: **80% of alarms served via batch** (50% cheaper). Track this metric.

### Minimum Bulk Window: 6 Hours
```
4h  → Accumulation window (collect enough jobs per batch)
1h  → Batch API processing (Anthropic / OpenAI Batch APIs)
30m → Image compositing (Sharp) + TTS generation + S3 upload
30m → Error buffer and automatic retry
─────────────────────────────────────────────
Total guaranteed minimum: 6 hours before alarm fire time
```

### Batch Scheduler (BullMQ — 4 Windows per Day UTC)
```
BATCH_A: runs at 00:00 UTC → processes alarms firing 06:00–10:00 UTC
BATCH_B: runs at 06:00 UTC → processes alarms firing 12:00–16:00 UTC
BATCH_C: runs at 12:00 UTC → processes alarms firing 18:00–22:00 UTC
BATCH_D: runs at 18:00 UTC → processes alarms firing 00:00–04:00 UTC
```
Each batch window has 6 hours of processing time and covers 4 hours of alarm slots.

### Job Classification on Alarm Save
Classify every alarm immediately upon creation:

```
IF (fire_time_utc - now_utc) >= 6 hours:
  → status: QUEUED_FOR_BATCH
  → assign to next eligible batch window
  → use Anthropic/OpenAI Batch API (50% cheaper)

ELSE IF (fire_time_utc - now_utc) between 30min and 6 hours:
  → status: IMMEDIATE_GENERATION
  → push to priority BullMQ queue
  → use standard API endpoint (full price, low volume)

ELSE IF (fire_time_utc - now_utc) < 30 minutes:
  → status: NO_AI_GENERATION
  → fire alarm with static fallback (Sharp only, no AI)
  → notify user: "Set alarms 6h+ in advance for AI-generated images"
```

### Alarm Modification Handling
```
If user modifies/cancels BEFORE batch starts:
  → cancel job, refund 1 credit, mark CANCELLED

If user modifies/cancels WHILE batch is in progress:
  → allow completion, store result, mark original as MODIFIED
  → reuse generated asset if new fire time is within 24h

If user modifies/cancels AFTER batch completes:
  → asset already generated, no refund, reuse for new time
```

### Batch API Integration
- **Anthropic Batch API**: bundle up to 10,000 requests per batch call.
  Poll for completion every 15 minutes. On completion, trigger image compositing
  pipeline per result.
- **OpenAI Batch API** (for Level 1 GPT-4o): same pattern, JSONL format input.
  24h SLA, typically completes in 1–3 hours.

### Cost Projection
```
100 users, avg 2 alarms/day = 200 calls/day

Without batch:  200 × $0.004 = $0.80/day = ~$24/month
With batch:     160 batch + 40 immediate = ($0.32 + $0.16) = $0.48/day = ~$14/month
Savings:        ~40% reduction, scales linearly with user growth
```

---

## RETRY LOGIC WITH EXPONENTIAL BACKOFF

### Failure Classification
Classify every error before deciding action:
```
TRANSIENT  (500, 502, 503, 504, network)  → retry with backoff
RATE_LIMIT (429)                          → retry respecting Retry-After header
TIMEOUT    (ETIMEDOUT, ECONNABORTED)      → retry with aggressive backoff
PERMANENT  (400, 401, 403, 422)           → skip retries → fallback immediately
```

### Backoff Formula
```
delay = min(base * (factor ^ attempt) + random_jitter, max_delay)

base         = 2000ms
factor       = 2
jitter       = random(0, 1000ms)    ← prevents thundering herd
max_delay    = 1_800_000ms (30min)
max_attempts = 5

Resulting delays:
Attempt 1: ~4s  | Attempt 2: ~8s  | Attempt 3: ~16s
Attempt 4: ~32s | Attempt 5: ~64s | → Fallback
Total worst case: ~2 minutes for all 5 attempts
```

### Deadline-Aware Waiting
```
NEVER wait longer than: (deadline_utc - now - 2 minutes)
IF calculated_wait > time_available   → skip wait → go to fallback immediately
IF time_until_deadline < 60 seconds   → skip all retries → go to fallback
IF time_until_deadline < 5 minutes    → static fallback guaranteed
```

### Partial Batch Failure Handling
After a batch completes, separate succeeded from failed jobs:
- For succeeded jobs: save generated assets to DB immediately
- For failed jobs:
  - If deadline already passed → static fallback immediately
  - If time available → retry individually (max 5 concurrent workers)
  - If all retries exhausted → static fallback
  - Run concurrent retries with `concurrency = 5` to avoid provider rate limits

### Static Fallback Guarantee
If all retries fail, the alarm **MUST** still fire. Fallback procedure:
- Use original user photo (no AI modification)
- Overlay alarm title as plain text using Sharp (no AI dependency)
- No audio — device default ringtone only
- Set `generation_status = FALLBACK` in DB
- Log `fallback_reason` for monitoring and support

### Required Implementation Files
```
packages/retry-engine/src/RetryEngine.ts          (core backoff logic)
packages/ai-service/src/BatchRetryManager.ts      (partial batch retry)
apps/api/src/workers/alarmFallbackWorker.ts       (BullMQ fallback worker)
apps/api/src/monitoring/retryMetrics.ts           (Sentry + metrics)
```

---

## DATABASE SCHEMA (Full Prisma)

Design and deliver the complete Prisma schema including all of the following models:

```prisma
// Users & Auth
model User {
  id                String        @id @default(cuid())
  email             String        @unique
  passwordHash      String?
  oauthProvider     String?
  oauthId           String?
  language          String        @default("en")
  timezone          String        @default("UTC")
  snapAlarmFolder   Boolean       @default(false)
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  alarms            Alarm[]
  subscription      Subscription?
  credits           Int           @default(5)
  communityPosts    CommunityPost[]
  votes             Vote[]
  reports           Report[]
  monthlyRankings   MonthlyRanking[]
}

// Subscriptions & Credits
model Subscription {
  id                 String    @id @default(cuid())
  userId             String    @unique
  user               User      @relation(fields: [userId], references: [id])
  tier               SubscriptionTier
  status             SubStatus
  revenuecatId       String?
  stripeCustomerId   String?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean   @default(false)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}

enum SubscriptionTier { FREE BASIC PRO }
enum SubStatus { ACTIVE CANCELLED PAST_DUE TRIALING }

// Alarms — core entity
model Alarm {
  id                    String           @id @default(cuid())
  userId                String
  user                  User             @relation(fields: [userId], references: [id])
  title                 String
  reason                String
  humorLevel            Int              // 1-4
  fireTimeUtc           DateTime
  timezoneSource        String           // user's timezone at creation
  mode                  AlarmMode
  originalImageS3Key    String
  generatedImageS3Key   String?
  generatedImageUrl     String?
  generatedAudioS3Key   String?
  generatedAudioUrl     String?
  generatedText         String?
  generationStatus      GenerationStatus @default(PENDING)
  batchJobId            String?
  batchWindow           String?          // e.g. "BATCH_A_2024-01-15"
  generationStartedAt   DateTime?
  generationCompletedAt DateTime?
  imageReadyAt          DateTime?        // must be <= fireTimeUtc - 5min
  retryCount            Int              @default(0)
  fallbackReason        String?
  calendarEventId       String?
  isActive              Boolean          @default(true)
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  communityPost         CommunityPost?
  generationLog         AIGenerationLog?
}

enum AlarmMode { IMAGE_ONLY IMAGE_WITH_AUDIO }
enum GenerationStatus {
  PENDING QUEUED_FOR_BATCH BATCH_SUBMITTED
  GENERATING COMPLETED FAILED FALLBACK CANCELLED
}

// Community Pool
model CommunityPost {
  id               String           @id @default(cuid())
  alarmId          String           @unique
  alarm            Alarm            @relation(fields: [alarmId], references: [id])
  userId           String
  user             User             @relation(fields: [userId], references: [id])
  moderationStatus ModerationStatus @default(PENDING)
  moderationReason String?
  voteCount        Int              @default(0)
  isVisible        Boolean          @default(false)
  sharedAt         DateTime         @default(now())
  votes            Vote[]
  reports          Report[]
}

enum ModerationStatus { PENDING APPROVED REJECTED UNDER_REVIEW }

model Vote {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  communityPostId String
  communityPost   CommunityPost @relation(fields: [communityPostId], references: [id])
  createdAt       DateTime      @default(now())
  @@unique([userId, communityPostId])
}

model Report {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  communityPostId String
  communityPost   CommunityPost @relation(fields: [communityPostId], references: [id])
  reason          String
  createdAt       DateTime      @default(now())
}

// AI Generation Audit Log
model AIGenerationLog {
  id           String   @id @default(cuid())
  alarmId      String   @unique
  alarm        Alarm    @relation(fields: [alarmId], references: [id])
  modelUsed    String
  humorLevel   Int
  tokensUsed   Int
  costUsd      Float
  durationMs   Int
  retryCount   Int      @default(0)
  batchOrSync  String   // "batch" | "sync"
  createdAt    DateTime @default(now())
}

// Monthly Rankings Snapshot
model MonthlyRanking {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  yearMonth   String   // e.g. "2024-01"
  rank        Int
  totalVotes  Int
  creditsAwarded Int
  createdAt   DateTime @default(now())
  @@unique([userId, yearMonth])
}
```

---

## FEATURES — PHASED DELIVERY

### Phase 1 — Core MVP
1. Auth: Email/password + Google OAuth + Apple Sign-In (mandatory for iOS)
2. Alarm creation flow:
   - Pick photo from gallery or SnapAlarm Folder
   - Set date/time → write alarm title + reason → select humor level (1–4)
   - Preview generated image before confirming
3. Alarm classification on save (batch vs immediate vs fallback — see rules above)
4. Alarm firing: full-screen display of generated image + text
5. Alarm Mode A: Image + text only (device default ringtone)
6. Alarm Mode B: Image + text + TTS audio (ElevenLabs reads generated text)
7. Calendar integration: import events, write back results
8. SnapAlarm Folder: opt-in dedicated album for photo source
9. Basic user profile, settings, timezone detection

### Phase 2 — Community Pool
10. Opt-in public sharing of AI-generated alarm images
11. Community feed: Trending (7-day votes), Monthly Top, All-Time Hall of Fame
12. One upvote per user per post (no downvotes)
13. Monthly leaderboard reset: Top 3 users earn 20 credits, Top 10 earn 10 credits
14. All shared images pass through automated content moderation before going public:
    - AWS Rekognition OR OpenAI Moderation API
    - Reject if confidence > 80% on: explicit, violence, hate symbols
    - All posts start as PENDING, only show publicly when status = APPROVED
15. Report button on every public post (3 reports → auto-flag for manual review)
16. Block user feature

### Phase 3 — Monetization
17. RevenueCat subscription integration (primary)
18. Stripe credit purchases (web/direct)
19. Paddle integration for EU markets (automatic VAT compliance)
20. Usage tracking and credit deduction middleware on every generation
21. Paywall screens with feature gating per tier

---

## MONETIZATION & PAYMENTS

### Subscription Tiers
```
Free  (0€/mo):    5 AI generations/month, view community pool only
Basic (2.99€/mo): 30 generations/month, all humor levels, TTS enabled
Pro   (6.99€/mo): Unlimited generations, priority AI queue, custom voices,
                  share to community pool, early access features
Credits:          À la carte — €0.99 = 10 credits (1 credit = 1 AI generation)
```

### Monthly Credit Rewards (Community Pool)
```
Top 3 users by votes  → 20 free credits each
Top 4–10 users        → 10 free credits each
Awards run on the 1st of each month at 00:00 UTC
```

### Payment Stack
- **RevenueCat** (primary): unified layer for iOS App Store + Google Play + Stripe.
  Implement RevenueCat Paywalls UI. Handle all subscription lifecycle.
- **Stripe** (secondary): direct credit purchases, web payments, markets outside
  app stores.
- **Paddle** (EU): automatic VAT handling, PSD2 compliance, EU receipt requirements.

### Required Webhooks
```
subscription_created    → activate tier, reset monthly credits
subscription_cancelled  → schedule downgrade at period end
payment_failed          → notify user, retry logic (3 attempts, then downgrade)
credit_purchased        → increment user.credits immediately
monthly_rank_awarded    → increment winner credits (internal cron, not webhook)
```

---

## SECURITY & COMPLIANCE

- JWT authentication with refresh token rotation (7-day refresh, 15-min access)
- Rate limiting per user per tier on all AI endpoints:
  - Free: 5 req/month | Basic: 30 req/month | Pro: unlimited, 10 req/min burst
- Images stored with signed URLs (15-min expiry for private, CDN for public pool)
- No user PII in AI prompts — anonymize before sending to any third-party API
- GDPR-compliant data deletion flow (delete all user data + S3 assets within 30 days)
- "AI Generated" watermark on all community pool images (Sharp overlay)
- Content moderation pipeline mandatory before any image goes public

---

## ERROR HANDLING & OBSERVABILITY

- Structured logging: **Pino** (API) + **Sentry** (mobile + API)
- Metrics tracking (Datadog or self-hosted Prometheus):
  ```
  alarm.generation.success          (by attempt number — target: >98% on attempt 1)
  alarm.generation.attempt_failed   (by attempt + failure_type)
  alarm.generation.fallback_used    (alert if > 2% of total alarms)
  alarm.generation.total_failure    (alert immediately — target: 0)
  alarm.generation.deadline_skip    (alert if > 0.5%)
  batch.completion_rate             (target: > 99%)
  batch.coverage_rate               (target: > 80% of all alarms via batch)
  api.cost_per_alarm.batch          (target: ~$0.002)
  api.cost_per_alarm.sync           (target: ~$0.004)
  community.moderation.reject_rate  (alert if > 15% — possible prompt abuse)
  ```
- AI cost tracking dashboard: tokens + images per user per month (abuse detection)
- Alert escalation: Slack webhook for CRITICAL alerts, email for WARNING

---

## ENVIRONMENT VARIABLES TEMPLATE

```env
# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/snapalarm

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# AWS / Storage
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=eu-central-1
S3_BUCKET_PRIVATE=snapalarm-private
S3_BUCKET_PUBLIC=snapalarm-public
CLOUDFRONT_DOMAIN=

# AI Providers
OPENAI_API_KEY=           # Level 1 — GPT-4o
ANTHROPIC_API_KEY=        # Level 2 — Claude Sonnet
GOOGLE_AI_API_KEY=        # Level 3 — Gemini 1.5 Pro
XAI_API_KEY=              # Level 4 — Grok-2 (mandatory)

# TTS
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID_DEFAULT=
GOOGLE_TTS_API_KEY=       # fallback

# Payments
REVENUECAT_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PADDLE_API_KEY=
PADDLE_WEBHOOK_SECRET=

# Moderation
AWS_REKOGNITION_REGION=
OPENAI_MODERATION_API_KEY=

# Monitoring
SENTRY_DSN_API=
SENTRY_DSN_MOBILE=
DATADOG_API_KEY=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_KEY_ID=
APPLE_TEAM_ID=
APPLE_PRIVATE_KEY=
```

---

## TESTING REQUIREMENTS

- **Jest** unit tests for all business logic:
  - RetryEngine: all failure types, deadline-aware waits, jitter bounds
  - BatchRetryManager: partial failure handling, concurrency limits
  - AIProviderService: correct model routing per humor level
  - Credit deduction middleware: tier enforcement, edge cases
- **Detox** E2E test stubs for critical flows:
  - Alarm creation → generation → fire
  - Community post share → moderation → appears in feed
  - Subscription purchase → tier upgrade → feature unlock
- Code coverage target: 80% on business logic packages

---

## DELIVERABLES — EXPECTED OUTPUT FORMAT

For each section, provide:
1. **Architecture Decision Record (ADR)** — brief rationale for technology choices
2. **Full working code** — complete, runnable files (no pseudocode, no snippets)
3. **API contract** — OpenAPI/Swagger spec for all endpoints
4. **Database migrations** — via Prisma migrate
5. **Environment variable template** — .env.example with all keys documented
6. **Step-by-step setup guide** — from `git clone` to running locally in under 15 minutes

---

## EXECUTION PRINCIPLES

- Mobile-first: every UI decision considers thumb reach, haptic feedback,
  and offline-first resilience
- AI calls are always async — never block the UI; use optimistic UI patterns
- Generated images MUST be ready before the alarm fires.
  Pre-generate on alarm save, NOT at alarm time.
- The 5-minute pre-delivery guarantee is non-negotiable.
  If it cannot be met, static fallback fires instead — but the alarm always fires.
- All AI-generated content shared publicly must include a subtle
  "AI Generated" watermark rendered by Sharp.
- Clean enough that a mid-level developer can onboard in 1 day.

---

## START INSTRUCTION

**Begin with Phase 1.**

Output in this exact order:
1. Complete monorepo project scaffold with all folder structures and package.json files
2. Full Prisma schema with all models above
3. `RetryEngine.ts` — core exponential backoff module, fully implemented and tested
4. `BatchRetryManager.ts` — partial batch retry with concurrency control
5. `AIProviderService.ts` — all 4 humor levels integrated with correct model routing
6. `alarmClassifier.ts` — job classification logic on alarm save (batch vs sync vs fallback)
7. `batchScheduler.ts` — BullMQ 4-window batch scheduler with UTC alignment

After completing all 7 files, pause and ask for confirmation before proceeding
to the remaining Phase 1 features.

**Do not summarize. Write the actual code.**
