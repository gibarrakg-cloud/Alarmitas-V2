import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import pino from 'pino';
import type { AIGenerationRequest, AIGenerationResult, HumorLevel } from '@snapalarm/shared-types';
import { RetryEngine, buildRetryableError } from '@snapalarm/retry-engine';

// ============================================================
// AIProviderService — Routes humor levels to specific AI models
//
// Level 1 (Clean)       → OpenAI GPT-4o
// Level 2 (Intellectual)→ Anthropic Claude Sonnet
// Level 3 (Sarcastic)   → Google Gemini 1.5 Pro
// Level 4 (Black Humor) → xAI Grok-2 (mandatory, non-negotiable)
// ============================================================

const logger = pino({ name: 'AIProviderService' });

// IMPORTANT: Never include user PII in prompts.
// image_base64 is passed directly to APIs but does not contain PII in structured metadata.

const HUMOR_PROMPTS: Record<HumorLevel, string> = {
  1: 'Write a warm, encouraging, wholesome alarm message appropriate for all ages. Be motivating and positive.',
  2: 'Write an alarm message using dry wit, cultural references, sophisticated wordplay, and subtle sarcasm. Intellectual humor only.',
  3: 'Write an alarm message with sharp sarcasm, self-deprecating humor, and bold observations. Edgy but not offensive.',
  4: 'Write an alarm message with no-filter dark comedy, brutal honesty, and shock value. Dark humor within legal limits. No hate speech or illegal content.',
};

export class AIProviderService {
  private openai: OpenAI;
  private anthropic: Anthropic;
  private gemini: GoogleGenerativeAI;

  constructor(
    private readonly config: {
      openai_api_key: string;
      anthropic_api_key: string;
      google_ai_api_key: string;
      xai_api_key: string;
    },
  ) {
    this.openai = new OpenAI({ apiKey: config.openai_api_key });
    this.anthropic = new Anthropic({ apiKey: config.anthropic_api_key });
    this.gemini = new GoogleGenerativeAI(config.google_ai_api_key);
  }

  // ---- Main entry point ------------------------------------

  async generate(
    request: AIGenerationRequest,
    deadline_utc: Date,
  ): Promise<AIGenerationResult> {
    const engine = new RetryEngine({
      deadline_utc,
      on_attempt_failed: (attempt, error, wait_ms) => {
        logger.warn({ attempt, error: error.message, wait_ms }, 'AI generation attempt failed');
      },
    });

    return engine.run(() => this.dispatch(request));
  }

  // ---- Dispatcher ------------------------------------------

  private async dispatch(request: AIGenerationRequest): Promise<AIGenerationResult> {
    switch (request.humor_level) {
      case 1:
        return this.callOpenAI(request);
      case 2:
        return this.callAnthropic(request);
      case 3:
        return this.callGemini(request);
      case 4:
        return this.callGrok(request);
    }
  }

  // ---- Level 1: OpenAI GPT-4o ------------------------------

  private async callOpenAI(req: AIGenerationRequest): Promise<AIGenerationResult> {
    const started = Date.now();
    const prompt = this.buildPrompt(req);

    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.image_base64}`, detail: 'low' } },
            ],
          },
        ],
        max_tokens: 150,
      });
    } catch (err) {
      throw this.wrapOpenAIError(err);
    }

    const text = response.choices[0]?.message?.content ?? '';
    const tokens = response.usage?.total_tokens ?? 0;

    logger.info({ model: 'gpt-4o', tokens, alarm_title: '[REDACTED]' }, 'AI generation complete');

    return {
      generated_text: text.trim(),
      model_used: 'gpt-4o',
      tokens_used: tokens,
      cost_usd: this.estimateCost('gpt-4o', tokens),
      duration_ms: Date.now() - started,
    };
  }

  // ---- Level 2: Anthropic Claude Sonnet --------------------

  private async callAnthropic(req: AIGenerationRequest): Promise<AIGenerationResult> {
    const started = Date.now();
    const prompt = this.buildPrompt(req);

    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: req.image_base64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
    } catch (err) {
      throw this.wrapAnthropicError(err);
    }

    const block = response.content.find((b) => b.type === 'text');
    const text = block?.type === 'text' ? block.text : '';
    const tokens = response.usage.input_tokens + response.usage.output_tokens;

    logger.info({ model: 'claude-sonnet-4-6', tokens, alarm_title: '[REDACTED]' }, 'AI generation complete');

    return {
      generated_text: text.trim(),
      model_used: 'claude-sonnet-4-6',
      tokens_used: tokens,
      cost_usd: this.estimateCost('claude-sonnet', tokens),
      duration_ms: Date.now() - started,
    };
  }

  // ---- Level 3: Google Gemini 1.5 Pro ----------------------

  private async callGemini(req: AIGenerationRequest): Promise<AIGenerationResult> {
    const started = Date.now();
    const prompt = this.buildPrompt(req);

    let text = '';
    let tokens = 0;
    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: req.image_base64 } },
        { text: prompt },
      ]);
      text = result.response.text();
      tokens = result.response.usageMetadata?.totalTokenCount ?? 0;
    } catch (err) {
      throw this.wrapGeminiError(err);
    }

    logger.info({ model: 'gemini-1.5-pro', tokens, alarm_title: '[REDACTED]' }, 'AI generation complete');

    return {
      generated_text: text.trim(),
      model_used: 'gemini-1.5-pro',
      tokens_used: tokens,
      cost_usd: this.estimateCost('gemini-1.5-pro', tokens),
      duration_ms: Date.now() - started,
    };
  }

  // ---- Level 4: xAI Grok-2 (MANDATORY) --------------------

  private async callGrok(req: AIGenerationRequest): Promise<AIGenerationResult> {
    const started = Date.now();
    const prompt = this.buildPrompt(req);

    let response: { data: { choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } } };
    try {
      response = await axios.post(
        'https://api.x.ai/v1/chat/completions',
        {
          model: 'grok-2-vision-1212',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.image_base64}` } },
              ],
            },
          ],
          max_tokens: 150,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.xai_api_key}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 500;
        const retry_after = err.response?.headers?.['retry-after'];
        throw buildRetryableError(status, err.message, retry_after);
      }
      throw err;
    }

    const text = response.data.choices[0]?.message?.content ?? '';
    const tokens = response.data.usage?.total_tokens ?? 0;

    logger.info({ model: 'grok-2-vision-1212', tokens, alarm_title: '[REDACTED]' }, 'AI generation complete');

    return {
      generated_text: text.trim(),
      model_used: 'grok-2-vision-1212',
      tokens_used: tokens,
      cost_usd: this.estimateCost('grok-2', tokens),
      duration_ms: Date.now() - started,
    };
  }

  // ---- Prompt builder (NO PII) ----------------------------

  private buildPrompt(req: AIGenerationRequest): string {
    const instruction = HUMOR_PROMPTS[req.humor_level];
    return [
      instruction,
      `Alarm title: "${req.alarm_title}"`,
      `Alarm reason: "${req.alarm_reason}"`,
      `Language: ${req.user_language}`,
      'Write ONLY the overlay text. Max 2 sentences. No quotes. No explanation.',
    ].join('\n');
  }

  // ---- Error wrappers --------------------------------------

  private wrapOpenAIError(err: unknown): Error {
    if (err instanceof OpenAI.APIError) {
      return buildRetryableError(
        err.status ?? 500,
        err.message,
        err.headers?.['retry-after'] as string | undefined,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private wrapAnthropicError(err: unknown): Error {
    if (err instanceof Anthropic.APIError) {
      return buildRetryableError(
        err.status ?? 500,
        err.message,
        err.headers?.['retry-after'] as string | undefined,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private wrapGeminiError(err: unknown): Error {
    // Gemini SDK throws generic errors; inspect message for status
    const message = err instanceof Error ? err.message : String(err);
    const statusMatch = message.match(/\[(\d{3})\]/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
    return buildRetryableError(status, message);
  }

  // ---- Cost estimation (USD per 1K tokens) -----------------

  private estimateCost(model: string, tokens: number): number {
    const rates: Record<string, number> = {
      'gpt-4o': 0.005,
      'claude-sonnet': 0.003,
      'gemini-1.5-pro': 0.0035,
      'grok-2': 0.004,
    };
    const rate = rates[model] ?? 0.004;
    return parseFloat(((tokens / 1000) * rate).toFixed(6));
  }
}
