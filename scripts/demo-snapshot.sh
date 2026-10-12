#!/usr/bin/env bash
# RU-46 — 시연 데이터(/data/worklog-demo)의 상태를 저장하고 되돌린다. 리허설에서 눌러 본 것을 회의 직전에 지우는 데 쓴다.
# 이 저장소는 테스트 서버(11112)를 시연 모드로 띄울 때 붙는다(docker-compose.test.yml TINCASE_TEST_MODE=demo). 절차는 docs/DEMO.md.
#
#   sudo bash scripts/demo-snapshot.sh save <이름>      DB(sqlite .backup) + 저장소(tar) → $DEMO_ROOT/snapshots/<이름>/
#   sudo bash scripts/demo-snapshot.sh restore <이름>   **11112가 이 저장소를 띄우지 않을 때만** — 지금 DB·저장소를 그 상태로 바꾼다
#   sudo bash scripts/demo-snapshot.sh list
#   sudo bash scripts/demo-snapshot.sh perms            소유·권한 맞추기 (10001:mhchoi · g+rwX · 디렉터리 setgid)
#   sudo bash scripts/demo-snapshot.sh status           11112가 지금 시연 데이터인지 테스트 데이터(실명)인지
#
# 왜 perms가 여기 있나: 컨테이너(uid 10001)는 디렉터리를 750으로 만든다 — 호스트(mhchoi)가 그 안에 다시 시드하지 못한다.
# 거꾸로 호스트가 시드한 파일(640, mhchoi)은 컨테이너가 못 읽는다. 그래서 호스트에서 시드하기 **전과 후**에 한 번씩 맞춘다.
#
# 대상은 DEMO_ROOT(기본 /data/worklog-demo) 하나다. 운영(/data/worklog)·테스트(/data/worklog-test)는 받지 않는다 —
# 시험용 임시 디렉터리(${TMPDIR:-/tmp} 아래)만 예외. 되돌릴 사본에 @example.invalid가 아닌 계정이 있으면 되돌리지 않는다.
set -euo pipefail

DEMO_DIR=/data/worklog-demo
ROOT_IN="${DEMO_ROOT:-$DEMO_DIR}"
CONTAINER="${DEMO_CONTAINER:-repman-test}"   # 11112 — 시연 모드도 같은 컨테이너다(별도 시연 인스턴스를 두지 않는다)
COMPOSE="docker compose -f docker-compose.test.yml -p repman-test"
GROUP="${DEMO_GROUP:-mhchoi}"

die() { echo "demo-snapshot: $*" >&2; exit 2; }

[ -d "$ROOT_IN" ] || die "디렉터리가 없습니다: $ROOT_IN"
ROOT="$(realpath "$ROOT_IN")"
TMP="$(realpath "${TMPDIR:-/tmp}")"
case "$ROOT" in
  "$DEMO_DIR") TESTING=0 ;;
  "$TMP"/*) TESTING=1 ;;
  *) die "$ROOT 는 시연 디렉터리가 아닙니다 ($DEMO_DIR 또는 $TMP 아래만)" ;;
esac
DB="$ROOT/db/worklog.db"
SNAPS="$ROOT/snapshots"

name_ok() { [[ "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]] || die "이름은 영문·숫자·._- 만 (받은 값: ${1:-없음})"; }

# 가짜 사람만 있는 DB인가 — 시드(demo-seed.ts)와 같은 기준
fake_only() {
  local n
  n="$(sqlite3 "$1" "SELECT COUNT(*) FROM User WHERE email NOT LIKE '%@example.invalid';")" || die "DB를 읽지 못했습니다: $1"
  [ "$n" = "0" ] || die "$1 에 @example.invalid가 아닌 계정이 ${n}명 있습니다 — 시연 DB가 아닙니다"
}

perms() { # 대상 경로
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "10001:$GROUP" "$1"
  elif [ "$TESTING" -eq 0 ]; then
    die "perms는 sudo로 — 소유자를 컨테이너(10001)로 바꿔야 합니다"
  fi
  chmod -R g+rwX,o-rwx "$1"
  find "$1" -type d -exec chmod g+s {} +
}

# 11112 컨테이너의 상태와 /data에 붙은 호스트 경로 — 「<상태>|<경로>」. 컨테이너가 없으면 빈 줄.
# 포트로는 알 수 없다: 같은 11112가 평소에는 테스트 데이터를, 시연 모드에서는 이 저장소를 띄운다.
# docker에 묻지 못하면(sudo 없이 등) 「안 띄운다」로 넘기지 않고 멈춘다 — 켜진 앱 밑에서 되돌리는 길을 막는다.
mounted() {
  command -v docker >/dev/null 2>&1 || die "docker가 없습니다 — 11112가 무엇을 띄우는지 알 수 없습니다"
  local ids
  ids="$(docker ps -aq --filter "name=^${CONTAINER}\$")" || die "docker에 묻지 못했습니다 — sudo로 실행하세요"
  [ -n "$ids" ] || return 0
  docker inspect "$CONTAINER" --format '{{.State.Status}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' \
    || die "docker inspect $CONTAINER 실패"
}
# 「<상태>|<경로>」의 경로가 이 저장소인가
on_root() { local src="${1#*|}"; [ -n "$src" ] && [ "$(realpath -m "$src")" = "$ROOT" ]; }

cmd="${1:-}"
case "$cmd" in
  save)
    name_ok "${2:-}"
    snap="$SNAPS/$2"
    [ -e "$snap" ] && die "이미 있습니다: $snap — 다른 이름을 쓰거나 지우세요"
    [ -f "$DB" ] || die "DB가 없습니다: $DB"
    fake_only "$DB"
    mkdir -p "$snap"
    # .backup은 앱이 켜져 있어도 일관된 사본을 만든다(SQLite 온라인 백업)
    sqlite3 "$DB" ".backup '$snap/worklog.db'"
    tar -C "$ROOT" --exclude=./db --exclude=./snapshots --exclude=./tmp -czf "$snap/storage.tar.gz" .
    {
      echo "saved=$(date '+%F %T %Z')"
      echo "weeks=$(sqlite3 "$snap/worklog.db" "SELECT group_concat(isoKey, ' ') FROM WeekSlot;")"
      echo "submissions=$(sqlite3 "$snap/worklog.db" "SELECT COUNT(*) FROM Submission;")"
    } >"$snap/meta.txt"
    perms "$snap"
    echo "저장했습니다: $snap ($(du -sh "$snap" | cut -f1))"
    ;;
  restore)
    name_ok "${2:-}"
    snap="$SNAPS/$2"
    [ -f "$snap/worklog.db" ] && [ -f "$snap/storage.tar.gz" ] || die "사본이 없거나 모자랍니다: $snap"
    # 켜진 앱 밑에서 DB 파일을 바꾸면 깨진다 — 11112가 **이 저장소를** 띄우는 동안은 되돌리지 않는다.
    # 테스트 데이터를 띄우는 중이면 이 저장소는 아무도 쓰지 않으니 되돌려도 된다. 「재시작 중」도 곧 켜지므로 막는다
    info=""
    if [ "$TESTING" -eq 0 ]; then
      info="$(mounted)"
      if on_root "$info"; then
        case "${info%%|*}" in
          exited|created|dead) ;;
          *) die "11112($CONTAINER, ${info%%|*})가 지금 이 저장소를 띄우고 있습니다. 먼저: sudo $COMPOSE stop" ;;
        esac
      fi
    fi
    [ "$(sqlite3 "$snap/worklog.db" 'PRAGMA integrity_check;')" = "ok" ] || die "사본 DB가 깨졌습니다: $snap/worklog.db"
    fake_only "$snap/worklog.db"
    mkdir -p "$ROOT/db"
    rm -f "$DB" "$DB-journal" "$DB-wal" "$DB-shm"
    cp "$snap/worklog.db" "$DB"
    find "$ROOT" -mindepth 1 -maxdepth 1 ! -name db ! -name snapshots -exec rm -rf {} +
    tar -C "$ROOT" -xzf "$snap/storage.tar.gz"
    perms "$ROOT"
    echo "되돌렸습니다: $snap → $ROOT"
    if [ "$TESTING" -eq 0 ]; then
      # stop/start는 컨테이너를 새로 만들지 않아 시연 모드가 그대로다. up -d를 변수 없이 치면 테스트 데이터로 돌아간다
      if on_root "$info"; then echo "켜기: sudo $COMPOSE start   (시연 모드 그대로)"
      else echo "시연 데이터로 전환: TINCASE_TEST_MODE=demo bash scripts/deploy.sh test --no-build"; fi
    fi
    ;;
  list)
    [ -d "$SNAPS" ] || { echo "(사본 없음)"; exit 0; }
    for s in "$SNAPS"/*/; do
      [ -d "$s" ] || continue
      echo "$(basename "$s")  $(tr '\n' ' ' <"$s/meta.txt" 2>/dev/null)"
    done
    ;;
  status)
    # 전환·되돌리기 뒤에 꼭 본다 — 변수를 sudo 앞에 두면(TINCASE_TEST_MODE=demo sudo …) 오류 없이 테스트 데이터로 뜬다
    info="$(mounted)"
    [ -n "$info" ] || { echo "11112: 컨테이너 $CONTAINER 가 없습니다"; exit 0; }
    state="${info%%|*}"; src="${info#*|}"
    if on_root "$info"; then
      fake_only "$DB"
      echo "11112: 시연 데이터 — $src (가짜 사람만) · $state"
    else
      echo "11112: 테스트 데이터 — ${src:-?} · $state   ← 운영 사본(실명). 강당 화면에 띄우지 않는다"
    fi
    ;;
  perms)
    perms "$ROOT"
    if [ "$(id -u)" -eq 0 ]; then echo "맞췄습니다: $ROOT (10001:$GROUP · g+rwX · setgid)"; else echo "맞췄습니다: $ROOT (g+rwX · setgid — 소유자는 그대로, 시험용)"; fi
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
