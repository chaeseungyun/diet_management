#!/usr/bin/env bash
# 백업 복원 (NFR-05 복원 시험): 암호화된 덤프를 지정한 DB 에 복원한다.
#   ./scripts/restore.sh backups/diet-20261106T000000Z.sql.gz.age            # 운영 DB 로 (확인 질문)
#   TARGET_DB=diet_restore_test ./scripts/restore.sh <file>                  # 별도 DB 로 복원 시험
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

FILE="${1:?usage: restore.sh <backup-file>}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
TARGET_DB="${TARGET_DB:-${POSTGRES_DB:-diet}}"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE")

if [[ "$TARGET_DB" == "${POSTGRES_DB:-diet}" ]]; then
  read -r -p "운영 DB($TARGET_DB)를 덮어씁니다. 계속하려면 yes 입력: " ANSWER
  [[ "$ANSWER" == "yes" ]] || { echo "aborted"; exit 1; }
  "${COMPOSE[@]}" stop api
fi

"${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" -c "CREATE DATABASE \"$TARGET_DB\";"

AGE_PASSPHRASE="$BACKUP_PASSPHRASE" age --decrypt --passphrase "$FILE" 2>/dev/null \
  | gunzip \
  | "${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q

echo "restored into $TARGET_DB"
# 복원 확인: 사용자 수와 테이블 목록
"${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d "$TARGET_DB" -c '\dt' -c 'SELECT count(*) AS users FROM users;'

if [[ "$TARGET_DB" == "${POSTGRES_DB:-diet}" ]]; then
  "${COMPOSE[@]}" start api
fi
