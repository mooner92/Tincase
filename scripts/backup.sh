#!/bin/bash
# OPS-07/08 — 백업 (2단 구조).
#   스냅샷: 컨테이너 안 sqlite3 .backup (uid 10001, WAL 안전 — cp 금지)
#   반출:   호스트(mhchoi)가 그룹 읽기로 gzip → NFS (root_squash 때문에 root 불가)
# 전제: /data/worklog은 10001:mhchoi, g+rX, 디렉터리 setgid (DEPLOY.md §1) — 재배포 때 chown 하지 않는 이유 (OPS-15)
#
# cron (mhchoi, passwordless sudo) — OPS-08. files도 매일이다 (2026-10-08부터, 예전엔 일요일만):
#   0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db      >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
#   30 3 * * *  /home/mhchoi/repman/scripts/backup.sh files   >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
set -euo pipefail

CONTAINER="repman"
# 시험(tests/backup-script.test.ts)만 이 둘을 바꾼다 — 크론은 아무것도 넘기지 않으므로 운영 경로 그대로다
DATA_ROOT="${BACKUP_DATA_ROOT:-/data/worklog}"
MOUNT="${BACKUP_MOUNT:-/mnt/backup}"
HOST_TMP="$DATA_ROOT/tmp"
DEST="$MOUNT/worklog"
KEEP_DB_DAYS=30
KEEP_FILE_WEEKS=12

# OPS-08 — NFS가 붙어 있지 않으면 **아무것도 쓰지 않고** 멈춘다. 지금 마운트는 손으로 한 것이라(fstab에 없음)
# 재부팅하면 빠진다. 그러면 $MOUNT은 루트 디스크의 빈 디렉터리가 되고, 「서버 디스크 장애에도 살아남을」 백업이
# 이미 찬 루트 디스크에 쌓이거나 권한 오류로 조용히 실패한다. 크론 로그에 이 줄이 보이면 fstab부터 (OPS-08).
if ! mountpoint -q "$MOUNT"; then
  echo "[backup] FATAL: $MOUNT 이(가) 마운트되어 있지 않습니다 — NFS를 붙인 뒤 다시 돌리세요 (docs/spec/09 OPS-08) ($(date -Is))" >&2
  exit 1
fi

mkdir -p "$DEST/db" "$DEST/files"

case "${1:-}" in
  db)
    SNAP="db-snapshot-$$.db"
    sudo -n docker exec "$CONTAINER" sqlite3 /data/db/worklog.db ".backup '/data/tmp/$SNAP'"
    OUT="$DEST/db/worklog-$(date +%F).db.gz"
    gzip -c "$HOST_TMP/$SNAP" > "$OUT"
    sudo -n docker exec "$CONTAINER" rm -f "/data/tmp/$SNAP"
    find "$DEST/db" -name 'worklog-*.db.gz' -mtime +$KEEP_DB_DAYS -delete
    echo "[backup] db ok: $OUT ($(date -Is))"
    ;;
  files)
    # 이름은 예전 그대로 divisions-날짜 — 보존 정리(find)와 로그를 바꾸지 않는다. 안에는 org/·templates/도 들어간다
    OUT="$DEST/files/divisions-$(date +%F).tar.gz"
    # 3단계 취합(총괄 섹션 원본·전사본)은 org/ 아래에 있다. 없는 서버에서 tar가 실패하지 않도록 있을 때만 넣는다
    DIRS=(divisions)
    [ -d "$DATA_ROOT/org" ] && DIRS+=(org)
    # OPS-08a (2026-10-10) — 전사 표준 양식(ST-20 — 운영자가 올린 원본과 이력 standard-v{n}.hwp)은 templates/ 아래에 있다.
    # DB 백업에는 그 행(StandardTemplate)이 들어가므로 빠지면 복원 뒤 「행은 있는데 파일이 없다」 — 각 부서가 양식을 만드는 원본이 사라진다
    [ -d "$DATA_ROOT/templates" ] && DIRS+=(templates)
    tar czf "$OUT" -C "$DATA_ROOT" "${DIRS[@]}"
    find "$DEST/files" -name 'divisions-*.tar.gz' -mtime +$((KEEP_FILE_WEEKS * 7)) -delete
    echo "[backup] files ok: $OUT [${DIRS[*]}] ($(date -Is))"
    ;;
  verify)
    # OPS-09 리허설 보조 — 최신 백업을 임시 위치에 풀어 열리는지 확인
    LATEST=$(ls -t "$DEST"/db/worklog-*.db.gz | head -1)
    TMP=$(mktemp -d)
    gunzip -c "$LATEST" > "$TMP/restored.db"
    N=$(sqlite3 "$TMP/restored.db" 'SELECT COUNT(*) FROM Division;')
    rm -rf "$TMP"
    echo "[backup] verify ok: $LATEST (Division=$N)"
    ;;
  *)
    echo "usage: $0 {db|files|verify}"; exit 1 ;;
esac
