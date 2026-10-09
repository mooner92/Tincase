#!/usr/bin/env bash
# OPS-43 — repman 빌드·재기동의 입구 하나. 끝나면 **우리** 빌드 찌꺼기만 치운다.
#
#   bash scripts/deploy.sh prod  [--no-build] [--ignore-window]   운영   (docker-compose.yml · 11111)
#   bash scripts/deploy.sh test  [--no-build]                     테스트 (docker-compose.test.yml -p repman-test · 11112)
#     (TINCASE_TEST_MODE=demo — sudo 뒤로 넘긴다, OPS-43h · 리허설이면 TINCASE_REHEARSAL=on — 덧붙이는 compose, OPS-47)
#   bash scripts/deploy.sh prune                                  빌드 없이 청소만 (손으로 빌드한 뒤 · 디스크 경보 때)
#
# 왜 스크립트인가: 2026-10-08, 이틀 사이 빌드를 거듭하자 태그 없는 이미지가 약 45개(약 35G) 쌓여 루트 디스크가
# 100%가 됐다. 일요일 타이머(OPS-42)는 그 사이에 돌지 않았고, 「빌드 뒤에 prune」은 사람이 기억해야 했다.
# 빌드하는 바로 그 명령이 치우게 한다. 규칙과 이유는 docs/spec/09-deployment-ops.md OPS-43.
#
# **sudo 없이 돌린다** (`sudo bash …` 아님). docker만 안에서 sudo로 부른다. 이유 두 가지:
#   - `TINCASE_TEST_MODE=demo sudo …`처럼 변수를 sudo 앞에 두면 sudo가 지워 **오류 없이** 평소 데이터로 뜬다(RU-45).
#     이 스크립트는 변수를 받아 sudo **뒤에** 붙여 넘기므로, 부르는 사람은 `TINCASE_TEST_MODE=demo bash …`로 쓰면 된다.
#   - root로 돌면 git이 남의 저장소라며 브랜치를 읽지 않는다(safe.directory) — 「운영은 main에서만」을 못 보므로 운영은 멈춘다.
#
# 이 파일은 `source`해도 아무 일도 하지 않는다 — 함수만 정의된다. 테스트(tests/deploy-script.test.ts)가
# 그렇게 불러 판정 함수를 직접 시험하고, `dk`를 가짜로 바꿔 끼워 어떤 docker 명령이 나가는지 본다.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# OPS-43a — Dockerfile의 모든 스테이지가 붙이는 표식. 청소는 **이 필터로만** 한다
APP_LABEL='org.tincase.app=repman'
# OPS-19 · OPS-43f — 이보다 적으면 빌드하지 않는다. 2G대에서 빌드하면 npm ci·레이어 쓰기 도중 ENOSPC로 죽는다
MIN_FREE_GIB=5
# 찌꺼기는 부모-자식 사슬이라 prune 한 번에 사슬 끝 하나씩 떨어진다. run 스테이지가 15단 남짓 — 넉넉히
PRUNE_MAX_ROUNDS=30
HEALTH_TIMEOUT_SEC=120
KST_TZ='Asia/Seoul'
LOCK_FILE='/tmp/repman-deploy.lock'

PROD_IMAGE='repman:latest'
ROLLBACK_IMAGE='repman:rollback'
# OPS-17a — 사람이 붙여 두는 **고정 태그**. deploy.sh는 옮기지도 지우지도 않는다(청소는 태그 없는 것만 — OPS-43).
# v2 전환(LAUNCH-v2 ①)에서 그 아침에 돌던 v1을 이 이름으로 붙잡는다. 다음 고정 태그를 붙이면 여기를 바꾼다
PINNED_ROLLBACK_IMAGE='repman:v1.39.0'
PROD_CONTAINER='repman'
TEST_CONTAINER='repman-test'

# OPS-43d — 표식이 생기기 전에 구운 repman **최종** 이미지의 지문. 이 문자열과 정확히 같아야만 지운다.
# deps·build 스테이지 찌꺼기는 node 기본 이미지와 설정이 같아 남의 Node 프로젝트와 구별할 수 없으므로 여기 넣지 않는다.
LEGACY_FORMAT='{{len .RepoTags}}|{{.Config.WorkingDir}}|{{.Config.User}}|{{json .Config.Entrypoint}}|{{json .Config.Cmd}}'
LEGACY_SIGNATURE='0|/app|app|["/usr/bin/tini","--"]|["./scripts/entrypoint.sh"]'

log() { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] 주의: %s\n' "$*" >&2; }
die() {
  printf '[deploy] 중단: %s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------------------------
# docker — 모든 호출이 여기를 거친다. sudo 여부를 한 곳에서 정하고, 테스트가 이 함수 하나만 바꿔 끼우면 된다.
#   dk [이름=값 ...] <docker 인자...>   앞쪽의 이름=값은 sudo **뒤에** 환경변수로 넘긴다 (RU-45의 함정)
# ---------------------------------------------------------------------------------------------------------------
dk() {
  local -a envs=()
  while [[ $# -gt 0 && $1 =~ ^[A-Z_][A-Z0-9_]*= ]]; do
    envs+=("$1")
    shift
  done
  if [[ $(id -u) -eq 0 ]]; then
    env ${envs[@]+"${envs[@]}"} docker "$@"
  else
    sudo ${envs[@]+"${envs[@]}"} docker "$@"
  fi
}

# 한 번에 하나만 돈다. 겹치면 이쪽 청소가, 저쪽 빌드가 다음 스테이지에서 COPY --from으로 쓸 스테이지 이미지
# (태그 없음 = 찌꺼기와 똑같이 보인다)를 지울 수 있다.
# /tmp는 sticky라 남(예: 예전에 root로 돈 실행)이 만든 파일은 쓰기로 열 수 없다 — 읽기로 열어도 flock은 된다
acquire_lock() {
  [[ -e $LOCK_FILE ]] || (umask 000 && : >"$LOCK_FILE") 2>/dev/null || true
  if command -v flock >/dev/null 2>&1 && { exec 9<"$LOCK_FILE"; } 2>/dev/null; then
    flock -n 9 || die "다른 deploy.sh가 돌고 있다 ($LOCK_FILE) — 끝난 뒤 다시"
  else
    warn "잠금을 잡지 못했다 ($LOCK_FILE) — 다른 빌드와 겹치지 않게 주의"
  fi
}

# 긴 빌드가 끝난 뒤에야 비밀번호를 물으면 자리를 비운 사이 멈춰 있다 — 처음에 한 번 받아 둔다
ensure_privilege() {
  [[ $(id -u) -eq 0 ]] && return 0
  # 비밀번호 없이 되는 sudo(NOPASSWD)가 먼저다 — `sudo -v`는 sudoers에 비밀번호 규칙이 하나라도 섞여 있으면
  # NOPASSWD여도 비밀번호를 묻고, 터미널이 없으면(백그라운드·원격 실행) 그대로 실패한다 (2026-10-08 data04에서 실측)
  sudo -n true 2>/dev/null && return 0
  sudo -v || die "sudo 인증 실패 — docker는 sudo가 필요하다 (mhchoi는 docker 그룹이 아니다)"
}

# ---------------------------------------------------------------------------------------------------------------
# 디스크 (OPS-19 · OPS-43f)
# ---------------------------------------------------------------------------------------------------------------

# 판정만 한다 — 「얼마면 빌드해도 되나」를 테스트가 숫자로 시험할 수 있게 df와 떼어 둔다.
#   enough_disk_to_build <사용 가능 KiB> [최소 GiB]   → 0 충분 · 1 부족 · 2 숫자가 아님(못 읽으면 부족으로 친다)
enough_disk_to_build() {
  local avail_kib=${1:-} min_gib=${2:-$MIN_FREE_GIB}
  [[ $avail_kib =~ ^[0-9]+$ ]] || return 2
  ((avail_kib >= min_gib * 1024 * 1024))
}

root_avail_kib() { df -Pk / | awk 'NR == 2 { print $4 }'; }

fmt_gib() { # <KiB> → "4.7G"
  if [[ ${1:-} =~ ^[0-9]+$ ]]; then awk -v k="$1" 'BEGIN { printf "%.1fG", k / 1048576 }'; else printf '?'; fi
}

show_disk() { log "루트 디스크 ($1): $(df -h / | awk 'NR == 2 { print $3 " 사용 · " $4 " 남음 · " $5 }')"; }

ensure_disk_for_build() { # <대상>
  local avail
  avail=$(root_avail_kib || true)
  if enough_disk_to_build "$avail"; then
    log "루트 여유 $(fmt_gib "$avail") — 빌드한다 (기준 ${MIN_FREE_GIB}G)"
    return 0
  fi
  # 우리 찌꺼기는 지워도 아무것도 안 깨진다 — 사람에게 넘기기 전에 먼저 치운다
  warn "루트 여유 $(fmt_gib "$avail") < ${MIN_FREE_GIB}G — 우리 빌드 찌꺼기부터 치운다"
  clean_leftovers || true
  avail=$(root_avail_kib || true)
  if enough_disk_to_build "$avail"; then
    log "치운 뒤 루트 여유 $(fmt_gib "$avail") — 빌드한다"
    return 0
  fi
  cat >&2 <<EOF
[deploy] 중단: 루트 여유 $(fmt_gib "$avail") — ${MIN_FREE_GIB}G 미만이라 빌드하지 않는다 (OPS-19 · OPS-43f).
         빌드 도중 디스크가 차면 ENOSPC로 죽고, 죽은 빌드의 찌꺼기가 또 남는다. 우리 찌꺼기는 이미 치웠다.
  할 일 (위에서부터):
    1) npm cache clean --force ; pip cache purge          mhchoi의 캐시 — 다음에 다시 받을 뿐이다
    2) sudo du -sh /var/lib/containerd                     도커 이미지는 여기 있다, /var/lib/docker 아님 (OPS-42)
    3) sudo docker images --filter dangling=true           남은 태그 없는 이미지 — 우리 것이 아니면 주인에게 묻는다
    4) 여유가 생기면 다시: bash scripts/deploy.sh $1
  지금 이미지로 다시 띄우기만 할 거면 빌드가 없으니 된다: bash scripts/deploy.sh $1 --no-build
EOF
  exit 1
}

# ---------------------------------------------------------------------------------------------------------------
# 청소 (OPS-43c · OPS-43d · OPS-43e) — 표식 있는 태그 없는 이미지만. 태그 붙은 이미지·남의 이미지는 손대지 않는다
# ---------------------------------------------------------------------------------------------------------------

count_removed() { # <prune 출력> → 지운 이미지 수
  # containerd 이미지 스토어는 한 이미지에 untagged(moby-dangling@…)·deleted 두 줄을 낼 수 있다 — deleted를 세고,
  # deleted가 없을 때만 untagged를 센다. 「이번 회차에 무언가 떨어졌나」만 맞으면 되풀이 판정은 옳다
  local n
  n=$(printf '%s\n' "${1:-}" | grep -ciE '^deleted:' || true)
  if [[ ${n:-0} -eq 0 ]]; then n=$(printf '%s\n' "${1:-}" | grep -ciE '^untagged:' || true); fi
  printf '%s' "${n:-0}"
}

prune_labeled_leftovers() {
  local round out n total=0
  for ((round = 1; round <= PRUNE_MAX_ROUNDS; round++)); do
    # -a를 붙이지 않는다 — 붙이면 태그 붙은(= 쓰는) 이미지까지 「안 쓰는 것」으로 지운다
    if ! out=$(dk image prune -f --filter "label=$APP_LABEL" 2>&1); then
      warn "image prune 실패 (${round}회차) — 청소를 멈춘다: $out"
      return 1
    fi
    n=$(count_removed "$out")
    if ((n == 0)); then
      log "표식 있는 찌꺼기 ${total}개 지움 (${round}회차에 더 없음)"
      return 0
    fi
    total=$((total + n))
  done
  warn "${PRUNE_MAX_ROUNDS}회를 돌고도 남았다 (${total}개 지움) — 다시 돌리면 이어서 지운다: bash scripts/deploy.sh prune"
}

# OPS-43d — 이 함수가 받는 한 줄이 지문과 **정확히** 같을 때만 참. 비슷한 것은 지우지 않는다
is_legacy_repman_leftover() { [[ ${1:-} == "$LEGACY_SIGNATURE" ]]; }

prune_legacy_leftovers() {
  local ids id sig removed=0 kept=0
  if ! ids=$(dk images --filter dangling=true --quiet --no-trunc 2>/dev/null); then
    warn "태그 없는 이미지 목록을 못 읽었다 — 표식 없는 옛 찌꺼기 청소를 건너뛴다"
    return 1
  fi
  for id in $(printf '%s\n' "$ids" | sort -u); do
    # 지우기 **직전에** 다시 본다 — 목록과 지우기 사이에 누가 태그를 붙였으면 지문의 태그 수가 0이 아니다
    sig=$(dk image inspect --format "$LEGACY_FORMAT" "$id" 2>/dev/null) || continue
    is_legacy_repman_leftover "$sig" || continue
    # -f 없이 — 컨테이너가 쓰거나 자식이 있으면 docker가 거절하고, 그러면 두면 된다
    if dk rmi "$id" >/dev/null 2>&1; then
      removed=$((removed + 1))
    else
      kept=$((kept + 1))
    fi
  done
  if ((removed + kept > 0)); then
    log "표식 없는 옛 repman 최종 이미지 ${removed}개 지움$( ((kept == 0)) || printf ', 쓰는 중이라 둔 것 %s개' "$kept")"
  fi
}

clean_leftovers() {
  log "빌드 찌꺼기 청소 — 표식 $APP_LABEL 인 태그 없는 이미지만 (남의 것·태그 붙은 것은 그대로)"
  local rc=0
  prune_labeled_leftovers || rc=1
  prune_legacy_leftovers || rc=1
  local left
  left=$(dk images --filter dangling=true --quiet 2>/dev/null | sort -u | grep -c . || true)
  if [[ ${left:-0} -gt 0 ]]; then
    log "태그 없는 이미지 ${left}개는 그대로 둔다 — 컨테이너가 쓰는 중이거나, 표식이 없어 우리 것인지 알 수 없다 (남의 것일 수 있다)"
  fi
  return "$rc"
}

# ---------------------------------------------------------------------------------------------------------------
# 배포 금지 시간대 (OPS-16) — 「그 주 마감 전날 11:30 ~ 마감 +2시간 30분」
# 계산은 src/lib/week.ts의 deadlineFor(WS-13·WS-18)·dayBeforeAt(NT-41)과 같다. 테스트가 둘을 맞대 본다.
# 전부 KST 벽시계로 센다 — 서버 TZ가 무엇이든 같은 답 (WS-07)
# ---------------------------------------------------------------------------------------------------------------

kst() { TZ="$KST_TZ" date "$@"; }

monday_of() { # <epoch> → 그 주 월요일 YYYY-MM-DD (WS-01 mondayOf)
  local day dow
  day=$(kst -d "@$1" +%F) || return 1
  dow=$(kst -d "@$1" +%u) || return 1
  kst -d "$day -$((dow - 1)) days" +%F
}

iso_key_of() { kst -d "$1" +%G-W%V; } # <월요일> → "2026-W41" (WS-09 — WeekSlot.isoKey)

deadline_epoch() { # <월요일> <요일 1=월…7=일> <HH:MM> → 마감 epoch (WS-13 deadlineFor)
  local day
  [[ ${2:-} =~ ^[1-7]$ ]] || return 2
  [[ ${3:-} =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]] || return 2
  day=$(kst -d "$1 +$(($2 - 1)) days" +%F) || return 2
  kst -d "$day $3" +%s
}

day_before_at() { # <epoch> <HH:MM> → 달력으로 하루 앞 그 시각 (NT-41 dayBeforeAt — 24시간 빼기가 아니다)
  local day
  day=$(kst -d "$(kst -d "@$1" +%F) -1 day" +%F) || return 1
  kst -d "$day $2" +%s
}

fmt_kst() { # <epoch> → "10/08(목) 14:00"
  local -a w=(일 월 화 수 목 금 토)
  local md wd hm
  read -r md wd hm <<<"$(kst -d "@$1" '+%m/%d %w %H:%M')"
  printf '%s(%s) %s' "$md" "${w[$wd]}" "$hm"
}

# 그 주의 금지 시간대 → "시작 끝 마감" (epoch). 부서마다 마감이 다를 수 있으니 **가장 이른** 마감 기준(slot-deadline.ts).
#   week_window <월요일> <예외 요일|""> <예외 시각|""> [부서 "요일|시각" ...]
# 켜진 부서가 없으면 평소 마감 목 14:00 (slot-deadline.ts FALLBACK · DM-10). 값이 이상하면 2 — 판정 못 함
week_window() {
  local monday=$1 odow=$2 otime=$3
  shift 3
  [[ $# -gt 0 ]] || set -- '4|14:00'
  local p e best=''
  for p in "$@"; do
    # 예외는 요일·시각을 따로 덮는다 — deadlineFor의 `??` 두 개와 같다 (WS-18)
    e=$(deadline_epoch "$monday" "${odow:-${p%%|*}}" "${otime:-${p#*|}}") || return 2
    if [[ -z $best ]] || ((e < best)); then best=$e; fi
  done
  local start
  start=$(day_before_at "$best" 11:30) || return 2
  printf '%s %s %s\n' "$start" "$((best + 150 * 60))" "$best"
}

window_keys() { # <now> → "이번주월요일 이번주키 다음주월요일 다음주키"
  local m1 m2
  m1=$(monday_of "$1") || return 1
  m2=$(monday_of "$(($1 + 7 * 86400))") || return 1
  printf '%s %s %s %s\n' "$m1" "$(iso_key_of "$m1")" "$m2" "$(iso_key_of "$m2")"
}

# 판정. 이번 주와 **다음 주**를 본다 — 마감이 월요일로 당겨지면 금지 시간대가 지난 주 일요일에 시작한다.
#   window_verdict <now epoch> <sqlite 출력: "slot|키|요일|시각" · "div|요일|시각|" 줄들>
#   → 0 배포해도 됨 · 1 금지 시간대 안 · 2 판정 못 함. 사람이 읽을 줄을 출력한다
window_verdict() {
  local now=$1 rows=${2:-}
  local m1 k1 m2 k2
  read -r m1 k1 m2 k2 <<<"$(window_keys "$now")" || return 2
  # 명령 치환의 실패는 read까지 오지 않는다 — 빈 값으로 계속 세면 엉뚱한 주를 판정한다
  [[ -n $m1 && -n $k1 && -n $m2 && -n $k2 ]] || return 2
  local -A odow=() otime=()
  local -a pol=()
  local kind a b c
  while IFS='|' read -r kind a b c; do
    case $kind in
      slot)
        [[ -n $a ]] || return 2
        odow[$a]=$b
        otime[$a]=$c
        ;;
      div) pol+=("$a|$b") ;;
      '') ;;
      *) return 2 ;;
    esac
  done <<<"$rows"
  local inside=0 m k w s e d
  for m in "$m1" "$m2"; do
    if [[ $m == "$m1" ]]; then k=$k1; else k=$k2; fi
    w=$(week_window "$m" "${odow[$k]:-}" "${otime[$k]:-}" ${pol[@]+"${pol[@]}"}) || return 2
    read -r s e d <<<"$w"
    printf '  %s 마감 %s → 배포 금지 %s ~ %s%s\n' "$k" "$(fmt_kst "$d")" "$(fmt_kst "$s")" "$(fmt_kst "$e")" \
      "$([[ -n ${odow[$k]:-}${otime[$k]:-} ]] && printf ' (이 주차만 예외)')"
    if ((now >= s && now < e)); then inside=1; fi
  done
  ((inside == 0)) || return 1
}

container_running() { [[ $(dk inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true) == true ]]; }

read_deadline_rows() { # <이번주키> <다음주키> — 컨테이너 안에서 읽기 전용으로 (DEPLOY.md §2b-0과 같은 표)
  [[ $1 =~ ^[0-9]{4}-W[0-9]{2}$ && $2 =~ ^[0-9]{4}-W[0-9]{2}$ ]] || return 2
  dk exec "$PROD_CONTAINER" sqlite3 -readonly -batch -noheader -separator '|' /data/db/worklog.db \
    "SELECT 'slot', isoKey, IFNULL(deadlineDowOverride, ''), IFNULL(deadlineTimeOverride, '') FROM WeekSlot WHERE isoKey IN ('$1', '$2');
     SELECT 'div', deadlineDow, deadlineTime, '' FROM Division WHERE isActive = 1 GROUP BY 2, 3;"
}

guard_deploy_window() {
  local now keys rows out rc
  now=$(date +%s)
  if ! container_running "$PROD_CONTAINER"; then
    # 이미 멈춘 서비스를 올리는 일은 금지 시간대가 막으려는 사고(마감 직전 재기동)를 키우지 않는다
    warn "운영 컨테이너가 떠 있지 않아 이번 주 마감을 읽지 못했다 — 멈춘 서비스를 올리는 것이므로 그대로 간다 (OPS-16, 손으로: DEPLOY.md §2b-0)"
    return 0
  fi
  keys=$(window_keys "$now") || die "이번 주 주차를 계산하지 못했다"
  # shellcheck disable=SC2086 # 공백으로 나뉜 키 넷을 그대로 위치 인자로
  set -- $keys
  rows=$(read_deadline_rows "$2" "$4") ||
    die "마감을 DB에서 읽지 못했다 — 판정할 수 없으면 막는다. DEPLOY.md §2b-0으로 손으로 본 뒤 --ignore-window"
  out=$(window_verdict "$now" "$rows") && rc=0 || rc=$?
  log "배포 금지 시간대 (OPS-16 — 마감 전날 11:30 ~ 마감 +2시간 30분):"
  [[ -n $out ]] && printf '%s\n' "$out"
  case $rc in
    0) log "지금($(fmt_kst "$now"))은 금지 시간대가 아니다" ;;
    1) die "지금($(fmt_kst "$now"))은 배포 금지 시간대다. 꼭 해야 하면(긴급 수정·롤백·병합 일시정지) --ignore-window" ;;
    *) die "마감 값을 해석하지 못했다 — 판정할 수 없으면 막는다. DEPLOY.md §2b-0으로 손으로 본 뒤 --ignore-window" ;;
  esac
}

# ---------------------------------------------------------------------------------------------------------------
# 테스트 서버 모드 (RU-45 — feat/org-rollup 이후). 시연 중인 화면을 변수 하나 빠뜨려 평소 데이터로 바꾸지 않게
#   test_mode_verdict <지금 떠 있는 TINCASE_ENV> <넘겨받은 TINCASE_TEST_MODE> → 0 가도 됨 · 1 멈춤
# ---------------------------------------------------------------------------------------------------------------
test_mode_verdict() {
  local current=${1:-} requested=${2:-}
  [[ $current == demo && -z $requested ]] && return 1
  return 0
}

check_test_mode() {
  local requested=${TINCASE_TEST_MODE:-} current
  if [[ -n $requested && ! $requested =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "TINCASE_TEST_MODE 값이 이상하다: '$requested' (test 또는 demo)"
  fi
  current=$(dk inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$TEST_CONTAINER" 2>/dev/null |
    sed -n 's/^TINCASE_ENV=//p' | head -n 1 || true)
  if ! test_mode_verdict "$current" "$requested"; then
    die "테스트 서버가 시연 모드(demo)로 떠 있다. 변수 없이 다시 올리면 평소 데이터로 돌아간다 — 시연 중이면
         TINCASE_TEST_MODE=demo bash scripts/deploy.sh test, 정말 되돌리려면 TINCASE_TEST_MODE=test 를 붙인다"
  fi
  log "테스트 서버 모드: ${requested:-기본(test)}${current:+ (지금 떠 있는 것: $current)}"
}

# ---------------------------------------------------------------------------------------------------------------
# OPS-47 — 리허설(scripts/rehearsal.ts · docs/REHEARSAL.md)은 테스트 서버의 자동 병합 스케줄러를 켠다 — 덧붙이는 compose
# (docker-compose.rehearsal.yml)로. **시연 모드(가짜 사람)에서만** — 평소 모드는 운영 사본(실명)이라, 켜면 그 주차가 저절로 병합·넘김되고
# 알림 수신함에 실명 알림이 쌓인다.
#   rehearsal_verdict <TINCASE_TEST_MODE> <TINCASE_REHEARSAL> → 0 가도 됨 · 1 멈춤(실명 데이터에서 켬) · 2 값이 이상함
# 변수 없이 다시 올리면 꺼진다(덧붙이는 파일 없이 만든다) — 리허설이 끝나면 `TINCASE_TEST_MODE=demo bash scripts/deploy.sh test --no-build`
# ---------------------------------------------------------------------------------------------------------------
rehearsal_verdict() {
  local mode=${1:-} on=${2:-}
  case $on in
    '' | off) return 0 ;;
    on) [[ $mode == demo ]] && return 0 || return 1 ;;
    *) return 2 ;;
  esac
}

check_rehearsal() {
  local rc=0
  rehearsal_verdict "${TINCASE_TEST_MODE:-}" "${TINCASE_REHEARSAL:-}" || rc=$?
  case $rc in
    0) [[ ${TINCASE_REHEARSAL:-} != on ]] || log "리허설: 자동 병합 스케줄러 켜짐 (docker-compose.rehearsal.yml — 끝나면 변수 없이 다시 올린다)" ;;
    1) die "TINCASE_REHEARSAL=on은 시연 모드(TINCASE_TEST_MODE=demo)에서만 — 평소 모드는 운영 사본(실명)이다 (OPS-47)" ;;
    *) die "TINCASE_REHEARSAL 값이 이상하다: '${TINCASE_REHEARSAL:-}' (on 또는 off)" ;;
  esac
}

# ---------------------------------------------------------------------------------------------------------------
# 운영 전용 — 브랜치 · 롤백 태그
# ---------------------------------------------------------------------------------------------------------------
# 빌드만이 아니라 --no-build 재기동도 본다 — 그 체크아웃의 docker-compose.yml(환경변수·볼륨)로 운영 컨테이너를
# 다시 만들기 때문이다. 프로젝트 이름을 repman으로 박았으므로(main 참고) 다른 worktree에서 돌려도 운영을 가리킨다.
# 브랜치를 못 읽으면 막는다 — 금지 시간대처럼 「판정 못 함 = 멈춤」. 흔한 원인은 `sudo bash …`(root에게 git이 답하지 않는다)
require_main_branch() {
  local branch dirty
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null) ||
    die "git으로 브랜치를 읽지 못했다 ($REPO_ROOT) — 운영은 main인지 확인되어야 돈다. sudo로 돌렸다면 sudo 없이 다시"
  # 브랜치를 운영에 구우면 repman:latest가 그 이미지가 되고, 다음 재기동이 조용히 그것으로 뜬다
  [[ $branch == main ]] ||
    die "운영은 main에서만 돌린다 (지금 $REPO_ROOT 은 $branch) — --no-build도 이 체크아웃의 compose 설정으로 운영을 다시 만든다. git switch main 뒤 다시"
  dirty=$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null || true)
  [[ -z $dirty ]] || warn "커밋하지 않은 변경이 운영에 들어간다 (빌드면 이미지로, --no-build면 compose 설정으로):"$'\n'"$dirty"
}

# 지금 롤백 태그가 가리키는 것 — 옮기지 않을 때 무엇이 남았는지 말하려고
rollback_now() {
  local id
  id=$(dk image inspect --format '{{.Id}}' "$ROLLBACK_IMAGE" 2>/dev/null || true)
  if [[ -n $id ]]; then printf ' (그대로: %s)' "${id:7:12}"; else printf ' (지금 없음)'; fi
}

# OPS-17a (2026-10-10) — 롤백 태그는 **지금 떠서 health가 ok인 운영 컨테이너의 이미지**에 붙인다. 그 밖이면 옮기지 않는다.
#   예전에는 빌드 직전에 늘 `repman:latest`를 repman:rollback으로 옮겼다. 그런데 latest는 「돌고 있는 것」이 아니다 —
#   ⑥을 빌드째 두 번 돌리면(첫 번째가 빌드 뒤 health에서 멈춤) 둘째의 태그가 방금 구운 v2를 가리켜 v1 이미지가 태그를 잃고 그 실행의 청소에 지워졌다.
#   누가 빌드만 하고 띄우지 않은 경우도 같다. 그래서 「되돌아갈 곳」의 조건 둘을 직접 본다: 지금 **도는** 이미지이고, 지금 **건강하다**.
tag_rollback() { # <health url>
  local url=$1 id
  if ! container_running "$PROD_CONTAINER"; then
    log "운영 컨테이너가 떠 있지 않다 — 되돌아갈 곳을 모르니 롤백 태그($ROLLBACK_IMAGE)를 옮기지 않는다$(rollback_now)"
    return 0
  fi
  id=$(dk inspect --format '{{.Image}}' "$PROD_CONTAINER" 2>/dev/null || true)
  if [[ -z $id ]]; then
    warn "운영 컨테이너의 이미지를 읽지 못했다 — 롤백 태그($ROLLBACK_IMAGE)를 옮기지 않는다$(rollback_now)"
    return 0
  fi
  if ! probe_health "$url"; then
    warn "지금 운영 health가 ok:true가 아니다 — 그 이미지는 되돌아갈 곳이 아니다. 롤백 태그($ROLLBACK_IMAGE)를 옮기지 않는다$(rollback_now)"
    return 0
  fi
  dk tag "$id" "$ROLLBACK_IMAGE" || die "$ROLLBACK_IMAGE 태그 실패 — 되돌릴 길 없이 빌드하지 않는다"
  log "롤백 태그: $ROLLBACK_IMAGE = 지금 떠서 health ok인 운영 컨테이너의 이미지 (${id:7:12}) — 그 전 세대는 태그가 떨어져 이번 청소에 지워진다"
}

# ---------------------------------------------------------------------------------------------------------------
# health (OPS-13) — ok:true가 올 때까지. compose healthcheck의 start_period가 20초라 그보다 넉넉히 기다린다
# ---------------------------------------------------------------------------------------------------------------
HEALTH_BODY=''
# 한 번만 묻는다 — 200 그리고 본문에 "ok":true. 본문은 HEALTH_BODY에 남는다
probe_health() { # <url>
  local res code
  res=$(curl -sS --max-time 5 -w $'\n%{http_code}' "$1" 2>&1 || true)
  code=${res##*$'\n'}
  HEALTH_BODY=${res%$'\n'*}
  [[ $code == 200 && $HEALTH_BODY == *'"ok":true'* ]]
}

wait_for_health() { # <url>
  local url=$1 give_up_at
  give_up_at=$(($(date +%s) + HEALTH_TIMEOUT_SEC))
  while :; do
    if probe_health "$url"; then return 0; fi
    (($(date +%s) < give_up_at)) || return 1
    sleep 3
  done
}

print_health() {
  if command -v jq >/dev/null 2>&1 && jq . <<<"$HEALTH_BODY" >/dev/null 2>&1; then
    jq . <<<"$HEALTH_BODY"
  else
    printf '%s\n' "$HEALTH_BODY"
  fi
}

usage() {
  cat <<'EOF'
사용법:
  bash scripts/deploy.sh prod  [--no-build] [--ignore-window]   운영 (main에서만 — --no-build도 · 금지 시간대 확인 · 롤백 태그)
  bash scripts/deploy.sh test  [--no-build]                     테스트 서버 (TINCASE_TEST_MODE가 있으면 넘긴다)
  bash scripts/deploy.sh prune                                  빌드 없이 우리 빌드 찌꺼기만 청소

  --no-build       빌드하지 않고 지금 이미지로 다시 띄운다(--force-recreate). 롤백 태그는 옮기지 않는다
  --ignore-window  운영 배포 금지 시간대(OPS-16)를 넘는다 — 긴급 수정·롤백·병합 일시정지 때만

sudo 없이 돌린다 — docker만 안에서 sudo로 부른다. 절차: docs/DEPLOY.md §2b · 규칙: spec 09 OPS-43
EOF
}

main() {
  local target='' build=1 ignore_window=0 arg
  for arg in "$@"; do
    case $arg in
      prod | test | prune)
        [[ -z $target ]] || die "대상은 하나만: $target · $arg"
        target=$arg
        ;;
      --no-build) build=0 ;;
      --ignore-window) ignore_window=1 ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage >&2
        die "모르는 인자: $arg"
        ;;
    esac
  done
  if [[ -z $target ]]; then
    usage >&2
    exit 1
  fi
  [[ $target != prune || $build -eq 1 ]] || die "prune은 빌드하지 않는다 — --no-build가 필요 없다"

  cd "$REPO_ROOT"
  acquire_lock
  ensure_privilege

  log "시작: $target$([[ $build -eq 0 ]] && printf ' --no-build') · $(git -C "$REPO_ROOT" log -1 --format='%h %s' 2>/dev/null || printf 'git 없음') · $(date '+%F %T')"
  show_disk "전"

  if [[ $target == prune ]]; then
    clean_leftovers || warn "청소가 끝까지 가지 못했다 — 위 메시지를 볼 것"
    show_disk "후"
    return 0
  fi

  local -a compose_args env_args=()
  local health_url
  if [[ $target == prod ]]; then
    # 프로젝트 이름을 박는다 — 다른 디렉터리(worktree)에서 돌려도 같은 compose 프로젝트(repman)를 가리킨다
    compose_args=(compose -f docker-compose.yml -p repman)
    health_url='http://127.0.0.1:11111/api/health'
    [[ -z ${TINCASE_TEST_MODE:-} ]] || warn "TINCASE_TEST_MODE는 테스트 서버 전용이다 — 운영에서는 쓰지 않는다"
    [[ -z ${TINCASE_REHEARSAL:-} ]] || warn "TINCASE_REHEARSAL은 테스트 서버 전용이다 — 운영에서는 쓰지 않는다"
    require_main_branch
    if ((ignore_window)); then
      warn "배포 금지 시간대 확인을 건너뛴다 (--ignore-window)"
    else
      guard_deploy_window
    fi
  else
    compose_args=(compose -f docker-compose.test.yml -p repman-test)
    health_url='http://127.0.0.1:11112/api/health'
    ((ignore_window == 0)) || log "테스트 서버에는 금지 시간대가 없다 — --ignore-window는 무시한다"
    check_test_mode
    check_rehearsal
    [[ -z ${TINCASE_TEST_MODE:-} ]] || env_args=("TINCASE_TEST_MODE=$TINCASE_TEST_MODE")
    [[ ${TINCASE_REHEARSAL:-} != on ]] || compose_args=(compose -f docker-compose.test.yml -f docker-compose.rehearsal.yml -p repman-test)
  fi

  if ((build)); then
    ensure_disk_for_build "$target"
    [[ $target != prod ]] || tag_rollback "$health_url"
    log "빌드: docker ${compose_args[*]} build"
    dk ${env_args[@]+"${env_args[@]}"} "${compose_args[@]}" build ||
      die "빌드 실패 — 돌고 있는 컨테이너는 그대로다. 남은 찌꺼기는 bash scripts/deploy.sh prune"
    log "기동: docker ${compose_args[*]} up -d"
    dk ${env_args[@]+"${env_args[@]}"} "${compose_args[@]}" up -d ||
      die "기동 실패 — docker ${compose_args[*]} ps · logs 로 볼 것. 운영 롤백은 OPS-17"
  else
    log "재기동(빌드 없음): docker ${compose_args[*]} up -d --no-build --force-recreate"
    dk ${env_args[@]+"${env_args[@]}"} "${compose_args[@]}" up -d --no-build --force-recreate ||
      die "기동 실패 — docker ${compose_args[*]} ps · logs 로 볼 것"
  fi

  local healthy=0
  log "health 대기 (최대 ${HEALTH_TIMEOUT_SEC}초): $health_url"
  if wait_for_health "$health_url"; then healthy=1; fi

  # health가 실패해도 치운다 — 되돌릴 이미지는 repman:rollback **태그**가 붙잡고 있어 닿지 않고,
  # 컨테이너가 쓰는 이미지는 image prune이 지우지 않는다 (OPS-43)
  clean_leftovers || warn "청소가 끝까지 가지 못했다 — 배포는 됐다. 나중에 bash scripts/deploy.sh prune"
  show_disk "후"

  print_health
  if ((healthy)); then
    log "끝: health ok:true"
    return 0
  fi
  printf '[deploy] 실패: health가 %s초 안에 ok:true가 아니다. checks를 읽는다 — checks.template만 fail이면 배포 탓이 아니다(OPS-41).\n' \
    "$HEALTH_TIMEOUT_SEC" >&2
  # 본문이 JSON이 아니면 앱이 기동하다 멈춘 것이다 — 이유는 로그의 FATAL 줄에 있다(스키마 OPS-48 · 메신저 설정 OPS-46 · 빈 DB OPS-05).
  # 스키마면 되돌리지 않는다 — db push 뒤 --no-build로 다시 띄운다(DEPLOY.md 2b-4 표)
  if [[ $HEALTH_BODY != *'"ok"'* ]]; then
    printf '         health에 닿지 못했다 — 앱이 기동하다 멈췄다. 이유: sudo docker %s logs --tail 60 | grep -A8 FATAL  (db push를 빠뜨렸으면 push 뒤 --no-build)\n' \
      "${compose_args[*]}" >&2
  fi
  if [[ $target == prod ]]; then
    # OPS-17a — 고정 태그가 있으면 그쪽을 먼저 권한다. repman:rollback은 「이번 배포 전에 떠서 건강하던 것」이라 대개 맞지만,
    # 같은 날 배포를 거듭하면 그것도 새 판일 수 있다 — 사람이 붙인 고정 태그(v2 전환의 v1)는 deploy.sh가 옮기지 않는다
    local back=$ROLLBACK_IMAGE note=''
    if dk image inspect --format '{{.Id}}' "$PINNED_ROLLBACK_IMAGE" >/dev/null 2>&1; then
      back=$PINNED_ROLLBACK_IMAGE
      note="   ← 고정 태그(LAUNCH-v2 §3.1). 직전에 떠서 건강하던 이미지로 가려면 $ROLLBACK_IMAGE"
    fi
    printf '         되돌리기(OPS-17): sudo docker tag %s %s && bash scripts/deploy.sh prod --no-build --ignore-window%s\n' \
      "$back" "$PROD_IMAGE" "$note" >&2
  fi
  exit 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
