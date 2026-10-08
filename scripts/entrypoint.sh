#!/bin/sh
# OPS-05 — 기동 순서. 실패 시 즉시 종료 (fail fast).
set -eu

# 스키마 적용은 배포 절차(호스트)에서 수행한다 — docs/DEPLOY.md §2.
# 이미지에 Prisma CLI를 넣지 않아 부팅이 단순하고 이미지가 작다.

echo "[boot] 1/4 저장소 디렉터리 확인"
mkdir -p "$STORAGE_ROOT/tmp" "$STORAGE_ROOT/divisions" 2>/dev/null || true

echo "[boot] 2/4 tmp 청소"
rm -f "$STORAGE_ROOT"/tmp/* 2>/dev/null || true

echo "[boot] 3/4 스키마·시드 확인 (없으면 안내 후 실패 — fail fast, OPS-05)"
DB_FILE="${DATABASE_URL#file:}"
COUNT=$(sqlite3 "$DB_FILE" 'SELECT COUNT(*) FROM Division;' 2>/dev/null || echo 0)
if [ "$COUNT" = "0" ]; then
  echo "[boot] FATAL: DB가 비어 있습니다. 호스트에서 스키마+시드를 먼저 실행하세요 (docs/DEPLOY.md §2):"
  echo "       DATABASE_URL=file:/data/worklog/db/worklog.db npx prisma db push --skip-generate"
  echo "       DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog SEED_TEMPLATE=1 npx tsx prisma/seed.ts"
  exit 1
fi

# RU-45·47 — 시연 모드(TINCASE_ENV=demo)는 화면 맨 위에 「사람과 업무는 모두 지어낸 것」이라고 띄운다.
# 그 말이 틀리면(실명이 든 DB가 붙었으면) 뜨지 않는다 — 강당 프로젝터에 실명이 「지어낸 것」 띠를 달고 나가느니 안 뜨는 게 낫다.
# 시드(demo-seed.ts)·되돌리기(demo-snapshot.sh)도 같은 기준으로 거절한다. 여기는 누가 저장소에 손으로 넣은 DB까지 막는다
if [ "${TINCASE_ENV:-}" = "demo" ]; then
  REAL=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM User WHERE email NOT LIKE '%@example.invalid';" 2>/dev/null || echo "?")
  if [ "$REAL" != "0" ]; then
    echo "[boot] FATAL: 시연 모드인데 @example.invalid가 아닌 계정이 있습니다 (${REAL}) — 시연 데이터가 아닙니다 (docs/DEMO.md)"
    exit 1
  fi
fi

echo "[boot] 4/4 서버 시작 (Division ${COUNT}개)"
exec node server.js
