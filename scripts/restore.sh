#!/usr/bin/env bash
# 백업 복원 (NFR-05 복원 시험, DEC-085): 암호화된 덤프를 지정한 DB 에 복원한다.
#   TARGET_DB=diet_restore_test ./scripts/restore.sh <file>                  # 별도 DB 로 복원 시험
#   ./scripts/restore.sh backups/diet-20261106T000000Z.sql.gz.age            # 운영 DB 로 (확인 질문)
# 비밀 키 파일(AGE-SECRET-KEY-1… 한 줄)이 필요하다. 기본 위치는 ~/diet-backup-key.txt,
# 다른 곳이면 BACKUP_KEY_FILE=<경로>. 평소에는 서버에 두지 않고 복원할 때만 올렸다가 지운다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

FILE="${1:?usage: restore.sh <backup-file>}"
[[ -f "$FILE" ]] || { echo "missing backup file: $FILE" >&2; exit 1; }
KEY_FILE="${BACKUP_KEY_FILE:-$HOME/diet-backup-key.txt}"
[[ -f "$KEY_FILE" ]] || { echo "missing key file: $KEY_FILE (set BACKUP_KEY_FILE)" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required (apt install age)" >&2; exit 1; }
TARGET_DB="${TARGET_DB:-${POSTGRES_DB:-diet}}"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE")

# DB 를 지우기 전에 파일이 이 키로 풀리고 압축이 온전한지 먼저 본다.
age --decrypt --identity "$KEY_FILE" "$FILE" | gzip -t \
  || { echo "cannot decrypt or read $FILE with $KEY_FILE; nothing was changed" >&2; exit 1; }

if [[ "$TARGET_DB" == "${POSTGRES_DB:-diet}" ]]; then
  read -r -p "운영 DB($TARGET_DB)를 덮어씁니다. 계속하려면 yes 입력: " ANSWER
  [[ "$ANSWER" == "yes" ]] || { echo "aborted"; exit 1; }
  "${COMPOSE[@]}" stop api
fi

"${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" -c "CREATE DATABASE \"$TARGET_DB\";"

age --decrypt --identity "$KEY_FILE" "$FILE" \
  | gunzip \
  | "${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q

echo "restored into $TARGET_DB"
# 복원 확인: 사용자 수와 테이블 목록
"${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-diet}" -d "$TARGET_DB" -c '\dt' -c 'SELECT count(*) AS users FROM users;'

if [[ "$TARGET_DB" == "${POSTGRES_DB:-diet}" ]]; then
  "${COMPOSE[@]}" start api
fi
