import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import type { RegisterRequest, LoginRequest, AuthTokens } from '@snapalarm/shared-types';

// ============================================================
// Auth routes
//   POST /auth/register
//   POST /auth/login
//   POST /auth/refresh
//   POST /auth/logout
// ============================================================

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  language: z.string().optional().default('en'),
  timezone: z.string().optional().default('UTC'),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const RefreshSchema = z.object({
  refresh_token: z.string(),
});

const SALT_ROUNDS = 12;
const REFRESH_EXPIRY_DAYS = 7;

export async function authRoutes(app: FastifyInstance) {
  // ---- POST /auth/register --------------------------------

  app.post<{ Body: RegisterRequest }>('/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { email, password, language, timezone } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, passwordHash, language, timezone },
      select: { id: true, email: true, language: true, timezone: true, credits: true },
    });

    const tokens = await issueTokens(app, user.id, user.email, 'FREE');
    return reply.status(201).send({ user, ...tokens });
  });

  // ---- POST /auth/login -----------------------------------

  app.post<{ Body: LoginRequest }>('/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { subscription: { select: { tier: true } } },
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const tier = user.subscription?.tier ?? 'FREE';
    const tokens = await issueTokens(app, user.id, user.email, tier);

    return reply.send({
      user: { id: user.id, email: user.email, language: user.language, timezone: user.timezone, credits: user.credits },
      ...tokens,
    });
  });

  // ---- POST /auth/refresh ---------------------------------

  app.post('/refresh', async (request, reply) => {
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'refresh_token required' });
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { token: parsed.data.refresh_token },
      include: { user: { include: { subscription: { select: { tier: true } } } } },
    });

    if (!stored || stored.expiresAt < new Date()) {
      // Delete expired token if found
      if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    // Rotate: delete old, issue new
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const tier = stored.user.subscription?.tier ?? 'FREE';
    const tokens = await issueTokens(app, stored.userId, stored.user.email, tier);

    return reply.send(tokens);
  });

  // ---- POST /auth/logout ----------------------------------

  app.post('/logout', { onRequest: [(app as any).authenticate] }, async (request, reply) => {
    const parsed = RefreshSchema.safeParse(request.body);
    if (parsed.success) {
      await prisma.refreshToken.deleteMany({ where: { token: parsed.data.refresh_token } });
    }
    return reply.send({ ok: true });
  });
}

// ---- Helpers ---------------------------------------------

async function issueTokens(
  app: FastifyInstance,
  userId: string,
  email: string,
  tier: string,
): Promise<AuthTokens> {
  const access_token = app.jwt.sign({ sub: userId, email, tier });

  // Generate opaque refresh token
  const refresh_token = Buffer.from(crypto.randomUUID()).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({ data: { userId, token: refresh_token, expiresAt } });

  return { access_token, refresh_token };
}
