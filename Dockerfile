# OPS-04 — 멀티스테이지. 비루트 실행, TZ 고정.
#
# OPS-43a — 모든 스테이지에서 FROM 바로 다음 줄은 LABEL org.tincase.app="repman"이다.
# 공용 서버라 빌드 찌꺼기(태그 없는 중간 이미지)를 지울 때 **우리 것만** 골라야 하는데, 찌꺼기에는
# 이름이 없어 이 표식이 유일한 손잡이다 (scripts/deploy.sh가 이 필터로만 prune한다).
# 레이블은 그 스테이지의 **뒤** 명령으로만 이어지므로 deps·build 스테이지에도, 맨 앞에 둔다 —
# 빠진 스테이지의 찌꺼기(npm ci·next build 결과, 용량의 대부분)는 남의 것과 구별할 수 없게 된다.
FROM node:22-bookworm-slim AS deps
LABEL org.tincase.app="repman"
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
LABEL org.tincase.app="repman"
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드에는 형식상 env만 필요 (env.ts 가드는 빌드 단계 스킵)
ENV DATABASE_URL="file:/tmp/build.db" \
    STORAGE_ROOT="/tmp" \
    CF_ACCESS_TEAM="build"
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
LABEL org.tincase.app="repman"
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
