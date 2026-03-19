FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/retry-engine/package.json ./packages/retry-engine/
COPY packages/ai-service/package.json ./packages/ai-service/
COPY packages/image-processor/package.json ./packages/image-processor/

RUN yarn install --frozen-lockfile

# Build packages
COPY packages ./packages
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

RUN yarn workspace @snapalarm/shared-types build
RUN yarn workspace @snapalarm/retry-engine build
RUN yarn workspace @snapalarm/ai-service build
RUN yarn workspace @snapalarm/image-processor build
RUN yarn workspace @snapalarm/api build

# Generate Prisma client
RUN yarn workspace @snapalarm/api prisma:generate

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
