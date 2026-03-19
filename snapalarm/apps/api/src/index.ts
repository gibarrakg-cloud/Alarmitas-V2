import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { prisma } from './prisma';
import { authRoutes } from './routes/auth';
import { alarmRoutes } from './routes/alarms';

// ============================================================
// Fastify API entry point
// ============================================================

const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
});

async function bootstrap() {
  // ---- Plugins -------------------------------------------

  await server.register(fastifyCors, {
    origin: process.env.APP_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  await server.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: undefined, // set to ioredis instance for distributed rate limiting
  });

  await server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: process.env.JWT_ACCESS_EXPIRY ?? '15m' },
  });

  await server.register(fastifySwagger, {
    openapi: {
      info: { title: 'SnapAlarm API', version: '1.0.0', description: 'SnapAlarm REST API' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await server.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // ---- Decorators ----------------------------------------

  server.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ---- Routes --------------------------------------------

  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(alarmRoutes, { prefix: '/alarms' });

  // ---- Health --------------------------------------------

  server.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ---- Start ---------------------------------------------

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await server.listen({ port, host: '0.0.0.0' });
  server.log.info(`API listening on port ${port}`);
}

// Graceful shutdown
const shutdown = async () => {
  await server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
