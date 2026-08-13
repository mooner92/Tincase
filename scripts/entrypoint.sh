#!/bin/sh
# OPS-05 — 기동 순서. 실패 시 즉시 종료 (fail fast).
set -eu

echo "[boot] 1/5 스키마 적용 (prisma db push — 기존 데이터 보존)"
node node_modules/prisma/build/index.js db push --skip-generate

echo "[boot] 2/5 저장소 디렉터리 확인"
mkdir -p "$STORAGE_ROOT/tmp" "$STORAGE_ROOT/divisions" "$(dirname "${DATABASE_URL#file:}")" 2>/dev/null || true

echo "[boot] 3/5 tmp 청소"
rm -f "$STORAGE_ROOT"/tmp/* 2>/dev/null || true

echo "[boot] 4/5 시드 확인 (부서가 없으면 안내 후 실패)"
DB_FILE="${DATABASE_URL#file:}"
COUNT=$(sqlite3 "$DB_FILE" 'SELECT COUNT(*) FROM Division;' 2>/dev/null || echo 0)
if [ "$COUNT" = "0" ]; then
  echo "[boot] FATAL: Division이 0개입니다. 호스트에서 시드를 먼저 실행하세요:"
  echo "       DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog SEED_TEMPLATE=1 npm run db:seed"
  exit 1
fi

echo "[boot] 5/5 서버 시작 (Division ${COUNT}개)"
exec node server.js
