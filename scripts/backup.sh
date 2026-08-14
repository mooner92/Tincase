#!/bin/bash
# OPS-07/08 — 백업 (2단 구조).
#   스냅샷: 컨테이너 안 sqlite3 .backup (uid 10001, WAL 안전 — cp 금지)
#   반출:   호스트(mhchoi)가 그룹 읽기로 gzip → NFS (root_squash 때문에 root 불가)
# 전제: /data/worklog은 10001:mhchoi, g+rX, 디렉터리 setgid (DEPLOY.md §1)
#
# cron (mhchoi, passwordless sudo):
#   0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db      >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
#   30 3 * * 0  /home/mhchoi/repman/scripts/backup.sh files   >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
set -euo pipefail

CONTAINER="repman"
HOST_TMP="/data/worklog/tmp"
SRC_FILES="/data/worklog/divisions"
DEST="/mnt/backup/worklog"
KEEP_DB_DAYS=30
KEEP_FILE_WEEKS=12

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
    OUT="$DEST/files/divisions-$(date +%F).tar.gz"
    tar czf "$OUT" -C /data/worklog divisions
    find "$DEST/files" -name 'divisions-*.tar.gz' -mtime +$((KEEP_FILE_WEEKS * 7)) -delete
    echo "[backup] files ok: $OUT ($(date -Is))"
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
