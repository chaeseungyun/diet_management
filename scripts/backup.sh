#!/usr/bin/env bash
# DB 백업 (NFR-05, DEC-014): pg_dump → gzip → age 대칭 암호화 → 로컬 보관 + 외부 저장소(rclone) 업로드.
# VM 의 cron 에서 매일 1회 실행. 설정은 deploy/.env (BACKUP_PASSPHRASE, BACKUP_REMOTE, BACKUP_KEEP_DAYS).
#   ./scripts/backup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
OUT_DIR="$ROOT/backups"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/diet-$STAMP.sql.gz.age"

command -v age >/dev/null || { echo "age is required (apt install age)" >&2; exit 1; }

# 컨테이너 안의 pg_dump 를 사용한다. 사진 등 파일은 포함하지 않는다(확장 단계 정책).
docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U "${POSTGRES_USER:-diet}" -d "${POSTGRES_DB:-diet}" --no-owner --no-privileges \
  | gzip -9 \
  | AGE_PASSPHRASE="$BACKUP_PASSPHRASE" age --passphrase --encrypt -o "$FILE" 2>/dev/null \
  || { echo "backup failed" >&2; rm -f "$FILE"; exit 1; }

echo "wrote $FILE ($(du -h "$FILE" | cut -f1))"

# 외부 보관 (rclone remote, 예: BACKUP_REMOTE=b2:diet-backups)
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || { echo "rclone is required for BACKUP_REMOTE" >&2; exit 1; }
  rclone copy "$FILE" "$BACKUP_REMOTE/" --quiet
  rclone delete "$BACKUP_REMOTE/" --min-age "${KEEP_DAYS}d" --quiet || true
  echo "uploaded to $BACKUP_REMOTE"
fi

# 로컬 보관 정리
find "$OUT_DIR" -name 'diet-*.sql.gz.age' -mtime "+$KEEP_DAYS" -delete
