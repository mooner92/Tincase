# OPS-04 — 멀티스테이지. 비루트 실행, TZ 고정.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드에는 형식상 env만 필요 (env.ts 가드는 빌드 단계 스킵)
ENV DATABASE_URL="file:/tmp/build.db" \
    STORAGE_ROOT="/tmp" \
    CF_ACCESS_TEAM="build"
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production \
    TZ=Asia/Seoul \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -u 10001 app \
    && apt-get update && apt-get install -y --no-install-recommends sqlite3 tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# standalone 출력 (+ Prisma 클라이언트 런타임 — CLI는 포함하지 않는다.
# 스키마 적용은 배포 절차에서 호스트가 수행: docs/DEPLOY.md §2)
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --chown=app:app scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x scripts/entrypoint.sh

USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./scripts/entrypoint.sh"]
