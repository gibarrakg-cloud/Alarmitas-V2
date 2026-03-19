# 📘 Plan de Desarrollo - SnapAlarm (Phase 1)

## 1) Preparación inicial del monorepo
1. Crear estructura:
   - `/snapalarm/apps/mobile`
   - `/snapalarm/apps/api`
   - `/snapalarm/packages/shared-types`
   - `/snapalarm/packages/ai-service`
   - `/snapalarm/packages/image-processor`
   - `/snapalarm/packages/retry-engine`
2. Inicializar `package.json` en cada workspace + `workspaces` en raíz.
3. Configurar `tsconfig.base.json` y `tsconfig.json` en cada paquete.
4. Crear `.env.example` con variables clave.
5. Configurar `docker-compose` para Postgres + Redis + API + expo dev.

## 2) Backend + base de datos
1. Escribir Prisma schema con modelos: User, Alarm, Subscription, CommunityPost, etc.
2. Ejecutar migración inicial (`npx prisma migrate dev --name init`).
3. Crear Fastify en `apps/api/src/index.ts`.
4. Conectar Prisma en `apps/api/src/prisma.ts`.
5. Crear endpoints básicos:
   - `POST /auth/register`
   - `POST /auth/login`
   - `GET /alarms`
   - `POST /alarms`
6. Añadir middleware JWT y protección de rutas.

## 3) Core de generación y clasificación de alarmas
1. Implementar `packages/retry-engine/src/RetryEngine.ts`.
2. Implementar `packages/ai-service/src/AIProviderService.ts` con routing por humor level.
3. Crear `apps/api/src/workers/alarmClassifier.ts` con:
   - > 6h → `QUEUED_FOR_BATCH`
   - 30m–6h → `IMMEDIATE_GENERATION`
   - <30m → `NO_AI_FALLBACK`
4. Crear `apps/api/src/workers/batchScheduler.ts` con 4 ventanas UTC.

## 4) Procesamiento de imagen y audio
1. Implementar `packages/image-processor` usando Sharp para overlay y watermark.
2. Worker `apps/api/src/workers/alarmFallbackWorker.ts`.
3. Integrar S3/R2 para subir imágenes y audio.

## 5) App móvil Expo
1. Crear app Expo TypeScript en `apps/mobile`.
2. Pantallas:
   - Login/Registro
   - Crear alarma (foto + título + motivo + humor + fecha/hora)
   - Lista de alarmas
   - Alarma full-screen
3. Conectar API (`axios`).
4. Usar `expo-image-picker`, `expo-media-library`, `expo-notifications`.
5. Programar alarmas con payload.

## 6) Phase 1 completo
1. Imagen + texto (modo `IMAGE_ONLY`).
2. Imagen + texto + TTS (modo `IMAGE_WITH_AUDIO`).
3. SnapAlarm Folder opt-in.
4. Integración con Expo Calendar.
5. Métricas básicas + Sentry.

## 7) Pruebas
1. Jest unit tests para:
   - `RetryEngine`
   - `BatchRetryManager`
   - `AIProviderService`
   - `alarmClassifier`
2. Configurar stubs E2E (Detox / Expo).
3. Validar flujo:
   - Crear usuario
   - Crear alarma
   - Generar imagen o fallback
   - Alarma se dispara.

---

## ✅ Siguiente paso rápido
- Copia este plan en `plan_snapalarm.md`.
- Inicia con el bloque 1 y 2 (estructura + Prisma + API).
- Te ayudo con el código base para `RetryEngine` y `alarmClassifier` cuando quieras.