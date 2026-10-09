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

# OPS-46 · NT-56 — 가짜 알림 수신함 주소는 시험·시연 서버에서만. 운영이 수신함으로 보내면 실제 사람에게 갈 알림이 사라지고,
# 시험·시연 서버가 실제 메신저로 보내면 사본·가짜 데이터에서 사람 화면에 팝업이 뜬다. 앱(env.ts)도 같은 판정으로 멈춘다 —
# 여기는 node보다 먼저, 이유를 로그 첫 줄에 남긴다
# OPS-46a (2026-10-10) — 같은 곳을 가리키는 다른 표기도 수신함으로 친다(env.ts `isSinkUrl`과 같게): 물음표·# 뒤를 떼고 · 소문자 · 겹 빗금을 하나로.
# 퍼센트 부호까지는 여기서 풀지 않는다 — 그 표기는 앱(env.ts)이 같은 판정으로 멈춘다(이유가 로그 첫 줄이 아닐 뿐)
SINK_CHECK=$(printf '%s' "${MESSENGER_URL:-}" | sed -e 's/[?#].*$//' | tr 'A-Z' 'a-z' | tr -s '/')
case "$SINK_CHECK" in
  */api/dev/messenger-sink | */api/dev/messenger-sink/) SINK_URL=1 ;;
  *) SINK_URL=0 ;;
esac
case "${TINCASE_ENV:-}" in
  test | demo) TRIAL=1 ;;
  *) TRIAL=0 ;;
esac
if [ "$SINK_URL" = "1" ] && [ "$TRIAL" = "0" ]; then
  echo "[boot] FATAL: MESSENGER_URL이 가짜 알림 수신함인데 시험·시연 서버가 아닙니다 (TINCASE_ENV=${TINCASE_ENV:-없음}) — OPS-46"
  exit 1
fi
if [ "$TRIAL" = "1" ] && [ -n "${MESSENGER_URL:-}" ] && [ "$SINK_URL" = "0" ]; then
  echo "[boot] FATAL: 시험·시연 서버(TINCASE_ENV=${TINCASE_ENV})의 MESSENGER_URL이 가짜 알림 수신함이 아닙니다 — 실제 사람에게 알림이 갑니다 (OPS-46)"
  exit 1
fi
# 셋째 경우도 env.ts(sinkBootProblem)와 같게 — 없으면 node까지 가서야 멈춰 이유가 로그 첫 줄에 남지 않는다
if [ "$SINK_URL" = "1" ] && [ "${MESSENGER_SINK:-}" != "on" ]; then
  echo "[boot] FATAL: MESSENGER_URL이 가짜 알림 수신함인데 MESSENGER_SINK=on이 아닙니다 — 알림마다 404로 실패합니다 (OPS-46)"
  exit 1
fi

echo "[boot] 4/4 서버 시작 (Division ${COUNT}개)"
exec node server.js
