// ============================================================
// SNAPALARM — Shared TypeScript Types
// Used across API, packages, and mobile app
// ============================================================

// ---- Enums ------------------------------------------------

export type SubscriptionTier = 'FREE' | 'BASIC' | 'PRO';
export type SubStatus = 'ACTIVE' | 'CANCELLED' | 'PAST_DUE' | 'TRIALING';
export type AlarmMode = 'IMAGE_ONLY' | 'IMAGE_WITH_AUDIO';
export type GenerationStatus =
  | 'PENDING'
  | 'QUEUED_FOR_BATCH'
  | 'BATCH_SUBMITTED'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'FALLBACK'
  | 'CANCELLED';
export type ModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW';

export type HumorLevel = 1 | 2 | 3 | 4;

// ---- AI Service -------------------------------------------

export interface AIGenerationRequest {
  image_base64: string;
  alarm_title: string;
  alarm_reason: string;
  humor_level: HumorLevel;
  user_language: string;
}

export interface AIGenerationResult {
  generated_text: string;
  model_used: string;
  tokens_used: number;
  cost_usd: number;
  duration_ms: number;
}

// ---- Alarm Classification ---------------------------------

export type AlarmClassification =
  | { type: 'QUEUED_FOR_BATCH'; batch_window: string }
  | { type: 'IMMEDIATE_GENERATION' }
  | { type: 'NO_AI_GENERATION' };

// ---- Batch ------------------------------------------------

export interface BatchJob {
  alarm_id: string;
  request: AIGenerationRequest;
  deadline_utc: Date;
}

export interface BatchResult {
  alarm_id: string;
  success: boolean;
  result?: AIGenerationResult;
  error?: string;
}

// ---- Retry Engine -----------------------------------------

export type FailureType = 'TRANSIENT' | 'RATE_LIMIT' | 'TIMEOUT' | 'PERMANENT';

export interface RetryConfig {
  base_ms: number;       // default 2000
  factor: number;        // default 2
  max_delay_ms: number;  // default 1_800_000 (30min)
  max_attempts: number;  // default 5
  jitter_ms: number;     // default 1000
}

// ---- Auth -------------------------------------------------

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  tier: SubscriptionTier;
  iat: number;
  exp: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

// ---- API Request/Response contracts ----------------------

export interface RegisterRequest {
  email: string;
  password: string;
  language?: string;
  timezone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateAlarmRequest {
  title: string;
  reason: string;
  humor_level: HumorLevel;
  fire_time_utc: string; // ISO 8601
  timezone_source: string;
  mode: AlarmMode;
  original_image_base64: string;
}

export interface AlarmResponse {
  id: string;
  title: string;
  reason: string;
  humor_level: HumorLevel;
  fire_time_utc: string;
  mode: AlarmMode;
  generation_status: GenerationStatus;
  generated_image_url: string | null;
  generated_audio_url: string | null;
  generated_text: string | null;
  is_active: boolean;
  created_at: string;
}

// ---- Image Processor --------------------------------------

export interface ImageOverlayOptions {
  input_s3_key: string;
  text: string;
  output_width?: number;  // default 800
  output_height?: number; // default 800
  watermark?: boolean;    // default false (true for community pool)
}

export interface ImageOverlayResult {
  output_s3_key: string;
  output_url: string;
  size_bytes: number;
}
