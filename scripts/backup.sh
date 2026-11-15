#!/usr/bin/env bash
# DB 백업 (NFR-05, DEC-014·085): pg_dump → gzip → age 공개 키 암호화 → 로컬 보관 + 외부 저장소(rclone) 업로드.
# VM 의 cron 에서 매일 1회 실행. 설정은 deploy/.env (BACKUP_RECIPIENT, BACKUP_REMOTE, BACKUP_KEEP_DAYS).
#   ./scripts/backup.sh
# 암호화에는 공개 키(age1…)만 쓴다. 풀 때 쓰는 비밀 키는 서버에 두지 않는다(scripts/restore.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${BACKUP_RECIPIENT:?BACKUP_RECIPIENT is required (age public key, age1...)}"
[[ "$BACKUP_RECIPIENT" == age1* ]] || { echo "BACKUP_RECIPIENT must be an age public key (age1...)" >&2; exit 1; }
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
OUT_DIR="$ROOT/backups"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/diet-$STAMP.sql.gz.age"

command -v age >/dev/null || { echo "age is required (apt install age)" >&2; exit 1; }

# 컨테이너 안의 pg_dump 를 사용한다. 사진 등 파일은 포함하지 않는다(확장 단계 정책).
# 오류 출력은 숨기지 않는다(cron 로그에 원인이 남아야 한다). pipefail 이라 pg_dump 실패도 잡힌다.
docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U "${POSTGRES_USER:-diet}" -d "${POSTGRES_DB:-diet}" --no-owner --no-privileges \
  | gzip -9 \
  | age --encrypt --recipient "$BACKUP_RECIPIENT" -o "$FILE" \
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
