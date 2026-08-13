#!/bin/bash
# OPS-07/08 — 백업. cron 예시:
#   0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db      >> /data/worklog/backup.log 2>&1
#   30 3 * * 0  /home/mhchoi/repman/scripts/backup.sh files   >> /data/worklog/backup.log 2>&1
set -euo pipefail

SRC_DB="/data/worklog/db/worklog.db"
SRC_FILES="/data/worklog/divisions"
DEST="/mnt/backup/worklog"            # NFS (192.168.1.108) — 이 서버 디스크 장애에도 생존
KEEP_DB_DAYS=30
KEEP_FILE_WEEKS=12

mkdir -p "$DEST/db" "$DEST/files"

case "${1:-}" in
  db)
    # WAL 안전 — 반드시 .backup. cp 금지 (OPS-07)
    OUT="$DEST/db/worklog-$(date +%F).db"
    sqlite3 "$SRC_DB" ".backup '$OUT'"
    gzip -f "$OUT"
    find "$DEST/db" -name 'worklog-*.db.gz' -mtime +$KEEP_DB_DAYS -delete
    echo "[backup] db ok: $OUT.gz ($(date -Is))"
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
    sqlite3 "$TMP/restored.db" 'SELECT COUNT(*) FROM Division;' \
      && echo "[backup] verify ok: $LATEST"
    rm -rf "$TMP"
    ;;
  *)
    echo "usage: $0 {db|files|verify}"; exit 1 ;;
esac
