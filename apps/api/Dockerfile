# NestJS API 이미지. CI에서 빌드하고 VM은 실행만 한다(DEC-011).
# 빌드 컨텍스트는 저장소 루트: docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat && corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @diet/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @diet/shared build \
 && pnpm --filter @diet/api prisma:generate \
 && pnpm --filter @diet/api build \
 && pnpm --filter @diet/api --prod deploy --legacy /out \
 && cd /out && npx prisma generate

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/prisma ./prisma
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
# 기동 시 마이그레이션 적용(이전 앱 버전과의 호환은 배포 전 확인, NFR-05)
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
