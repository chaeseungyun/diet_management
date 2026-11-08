# 식단·재고·체중 관리 웹앱 — 운영 문서

버전: v0.2 (2026-11-06, 단계 1) / 근거: [`requirements-phase1.md`](requirements-phase1.md) NFR-04·05·06·07, [`decisions.md`](decisions.md) DEC-010·011·014·037·045·047~053

NFR-07이 요구하는 운영 문서(로컬 실행, 환경 변수, 배포, 백업·복원, 도메인 갱신, 장애 대응, 비용 확인)를 한곳에 둔다. 도메인·VM 은 2026-11-07 구매했다(§4 표, §9). 첫 배포·HTTPS·백업 복원 확인 결과는 수행한 뒤 §11 에 적는다.

## 1. 구성 요약

| 항목 | 값 |
| --- | --- |
| 리포지터리 | pnpm 모노레포. `apps/web`(Next.js 16), `apps/api`(NestJS 11), `packages/shared`(상수·순수 함수) |
| 런타임 | Node 22, pnpm 10.24 (`packageManager` 고정) |
| DB | PostgreSQL 18. 로컬은 embedded-postgres, 운영은 `postgres:18-alpine` 컨테이너 |
| ORM | Prisma 6. 스키마 `apps/api/prisma/schema.prisma`, 마이그레이션 `apps/api/prisma/migrations` |
| 인증 | 카카오 OAuth → HttpOnly·SameSite=Lax 쿠키의 HS256 JWT(7일). 서버 세션 저장소 없음 (D-07) |
| 오리진 | 웹·API 같은 오리진. `/api/*`만 API로 분기(운영 Caddy, 개발 Next rewrite) (D-14) |
| 이미지 | CI(GitHub Actions)가 `ghcr.io/<owner>/diet-api`, `diet-web`을 빌드·푸시. VM은 실행만 (DEC-011) |

## 2. 로컬 실행

```bash
pnpm install
pnpm --filter @diet/shared build          # 공유 패키지 (web·api가 dist를 참조)
pnpm --filter @diet/api prisma:generate

cp apps/api/.env.example apps/api/.env    # JWT_SECRET, KAKAO_* 채우기
cp apps/web/.env.example apps/web/.env

pnpm db:dev                                # 터미널 1: 로컬 PostgreSQL (127.0.0.1:54320, 데이터 .local/pgdata)
pnpm --filter @diet/api prisma:deploy      # 터미널 2: 마이그레이션 적용
pnpm --filter @diet/api dev                # API :4000  (Swagger: http://localhost:4000/api/v1/docs)
pnpm --filter @diet/web dev                # 웹 :3000   (/api/* 는 :4000 으로 rewrite)
```

- 루트의 `pnpm dev`는 API·웹을 동시에 띄운다. Nest는 컴파일 때문에 웹보다 5~10초 늦게 뜨므로 그 사이 접속하면 "화면을 불러오지 못했습니다"(`app/error.tsx`)가 보인다. API 로그에 `Found 0 errors`가 찍힌 뒤 "다시 시도"를 누르면 된다.
- Prisma 스키마를 바꿀 때는 API dev 서버를 먼저 끈다. 실행 중인 API 프로세스가 쿼리 엔진 DLL을 잠가 `prisma generate`가 EPERM으로 실패한다(Windows).
- **개발·테스트용 계정**(DEC-067): `apps/api/.env` 에 `DEV_LOGIN_ENABLED=true` 가 있으면 로그인 화면에 '개발용 계정으로 들어가기' 버튼이 생기고 `GET /api/v1/auth/dev` 가 `dev:tester`(닉네임 '테스터') 계정으로 세션 쿠키를 발급한다. `/api/v1/auth/dev?as=second` 처럼 이름을 바꾸면 다른 계정이라 사용자 격리를 손으로 확인할 수 있다. 로컬 DB 에는 `dev:tester` 가 2026-11-08 에 만들어져 있다. production 에서 이 변수가 있으면 API 가 부팅을 거부하므로 운영에 샐 수 없다.
- 브라우저는 항상 `http://localhost:3000`으로 접근한다. 카카오 리다이렉트 URI도 `http://localhost:3000/api/v1/auth/kakao/callback`이어야 쿠키가 같은 오리진에 설정된다.
- 카카오 개발자 콘솔: 앱 생성 → 플랫폼 Web `http://localhost:3000` 등록 → 카카오 로그인 활성화 → Redirect URI 위 값 등록 → REST API 키를 `KAKAO_CLIENT_ID`, (보안 탭에서 켰다면) Client Secret을 `KAKAO_CLIENT_SECRET`에. 동의 항목은 닉네임만.
- Docker Desktop이 있으면 `deploy/docker-compose.yml`로 운영과 같은 구성을 로컬에서 띄울 수 있다(§4). 단계 0 개발 PC에는 Docker가 없어 embedded-postgres로 대체했다(DEC-050).

## 3. 검증 명령

| 명령 | 내용 |
| --- | --- |
| `pnpm typecheck` | 세 패키지 `tsc --noEmit` (strict) |
| `pnpm test` | shared 단위 테스트, API 단위·e2e 테스트. e2e는 `DATABASE_URL`이 없으면 embedded-postgres를 임시로 띄운다(`apps/api/test/run-with-db.mjs`) |
| `pnpm --filter @diet/api test:e2e` | 인수 테스트: 단계 0(카카오 로그인 흐름, 격리, CSRF, 422, 로그아웃, 소프트 삭제) + 단계 1(시나리오 1·2·3·4·5·7, 외부 식사·추가 간식·D-03 보완·구매·목표·체중·오늘 화면, 동시 수정·멱등성 경쟁) |
| `pnpm --filter @diet/api openapi:export && pnpm --filter @diet/web api-types` | OpenAPI → `apps/web/src/lib/api-types.d.ts` 재생성. 둘 다 커밋하며 CI가 최신 여부를 검사한다 |
| `pnpm build` | shared → api(`nest build`) → web(`next build`, standalone) |
| `pnpm format:check` | Prettier |

CI(`.github/workflows/ci.yml`)는 push·PR마다 위를 모두 돌리고, `main` push면 두 이미지를 GHCR에 올린다(태그 `latest`, `<sha>`).

## 4. 배포 (VM)

실제 값(2026-11-07 구매, DEC-062):

| 항목 | 값 |
| --- | --- |
| VM | AWS Lightsail, 월 12달러 플랜(RAM 2GB·SSD 60GB), 고정 IP `16.179.16.224`, 방화벽 22/80/443 |
| 도메인 | `kkinilog.com`, Cloudflare Registrar(연 11.17달러, 자동 갱신·Transfer lock·WHOIS 비공개) |
| DNS | Cloudflare. `A @ → 16.179.16.224`, `CNAME www → kkinilog.com`, 둘 다 **DNS only**(프록시 끔). Caddy 가 Let's Encrypt 를 직접 받으므로 프록시를 켜면 발급이 실패한다 |
| 이미지 | GHCR 공개 패키지 `ghcr.io/chaeseungyun/diet-api`, `diet-web`. 익명 pull 가능, `docker login` 불필요 |
| 배포 | `main` push → CI `verify` → `images` → `deploy`(SSH 로 VM 에서 pull·up, 아래 4-2) |

### 4-1. VM 1회 준비

```bash
# (로컬) Lightsail 키로 접속. 기본 사용자는 Ubuntu 이미지 기준 ubuntu
ssh -i <키>.pem ubuntu@16.179.16.224

# 패키지·스왑(2GB RAM 이라 이미지 pull·마이그레이션 때 여유용)
sudo apt update && sudo apt install -y docker.io docker-compose-v2 age rclone git
sudo usermod -aG docker $USER && newgrp docker
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 저장소·환경 변수 (deploy/.env 는 커밋하지 않는다)
git clone https://github.com/chaeseungyun/diet_management.git ~/diet && cd ~/diet
cp deploy/.env.example deploy/.env && nano deploy/.env
#   DOMAIN=kkinilog.com, POSTGRES_PASSWORD=<openssl rand -hex 24 출력>, JWT_SECRET=<openssl rand -hex 48 출력>(hex: 접속 URL 에 안전),
#   KAKAO_CLIENT_ID / KAKAO_CLIENT_SECRET, BACKUP_PASSPHRASE(비밀번호 관리자에도 보관), BACKUP_REMOTE(rclone 원격, 없으면 비움)
chmod 600 deploy/.env

# 첫 기동(이후는 CD 가 한다)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs caddy | tail -20   # certificate obtained 확인
curl -fsS https://kkinilog.com/api/v1/health

# 배포 전용 SSH 키(Lightsail .pem 은 GitHub 에 올리지 않는다)
ssh-keygen -t ed25519 -N '' -C deploy@github -f ~/.ssh/deploy_key
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key          # → GitHub secret DEPLOY_SSH_KEY (전체, BEGIN~END)
ssh-keyscan -t ed25519 16.179.16.224 2>/dev/null   # → DEPLOY_HOST_KEY (한 줄)
rm ~/.ssh/deploy_key           # 개인키는 GitHub 에만 둔다
```

### 4-2. 자동 배포(CD)

- GitHub → Settings → Secrets and variables → Actions 에 `DEPLOY_HOST`(`16.179.16.224`), `DEPLOY_USER`(`ubuntu`), `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY` 를 넣는다.
- `main` 에 push 하면 `verify` 통과 → 두 이미지를 `latest`·`<sha>` 로 GHCR 에 올림 → `deploy` job 이 VM 에서 `git pull --ff-only` 뒤 `<sha>` 태그로 `pull`·`up -d` 하고 `/api/v1/health` 를 확인한다. 동시 배포는 `deploy-production` 그룹으로 직렬화한다.
- VM 의 `~/diet` 는 `main` 을 추적하고 로컬 수정이 없어야 한다(`deploy/.env` 는 untracked 라 괜찮다). compose·Caddyfile 변경도 이 `git pull` 로 반영된다.
- 수동 배포가 필요하면 4-1 의 "첫 기동" 명령을 그대로 친다(`latest` = 마지막 성공 push).

- API 컨테이너는 기동 시 `prisma migrate deploy`를 실행한다. **DB 변경이 이전 앱 버전과 호환되는지**(컬럼 삭제·NOT NULL 추가 등) 배포 전에 확인한다(NFR-05).
- 롤백: Actions 에서 이전에 성공한 run 의 `deploy` job 을 Re-run 하거나, VM 에서 `API_IMAGE=…:<이전 sha> WEB_IMAGE=…:<이전 sha>` 를 앞에 붙여 `up -d`. 마이그레이션은 되돌리지 않으므로 호환성 확인이 롤백의 전제다.
- 카카오 콘솔에 운영 Redirect URI `https://kkinilog.com/api/v1/auth/kakao/callback` 과 플랫폼 Web 사이트 도메인 `https://kkinilog.com` 을 추가한다. 출시 대상 계정 정책은 미정(DEC-038).
- 단계 0 완료 조건의 배포·HTTPS·백업 복원 확인은 첫 배포 때 수행하고 결과를 §11 에 적는다.

## 5. 백업·복원 (DEC-014: 매일 1회, 7일 보관, RPO/RTO 24h)

```bash
# 백업: pg_dump → gzip → age 암호화 → backups/ + rclone 원격(BACKUP_REMOTE)
./scripts/backup.sh
# cron (매일 03:10 KST = 18:10 UTC)
10 18 * * * cd /home/<user>/diet && ./scripts/backup.sh >> /var/log/diet-backup.log 2>&1

# 복원 시험(별도 DB): 출시 전 1회 필수
TARGET_DB=diet_restore_test ./scripts/restore.sh backups/diet-<stamp>.sql.gz.age
# 운영 복원(확인 질문 있음, API 정지 후 복원)
./scripts/restore.sh backups/diet-<stamp>.sql.gz.age
```

- `BACKUP_PASSPHRASE`는 VM 밖(비밀번호 관리자)에도 보관한다. 이것이 없으면 백업은 복원할 수 없다.
- 백업에는 사진 등 파일이 없다(확장 단계 정책). 개인 식사 내용은 DB에 있으므로 백업 파일 자체를 공개 저장소에 두지 않는다.
- 백업 만료: 7일 후 로컬·원격 모두 삭제. 계정 삭제 요청 시 "최대 7일 안에 백업에서도 사라진다"로 안내한다(NFR-04).

## 6. 계정·개인 데이터 삭제 절차 (NFR-04)

1. 사용자가 S-73에서 삭제 요청 → `DELETE /api/v1/me` → `users.deleted_at` 설정, 쿠키 삭제. 이후 같은 카카오 계정의 로그인·모든 요청은 거부된다.
2. 운영자는 7일 안에 하드 삭제를 수행한다(단계 1에서 사용자 소유 테이블이 늘어나면 FK cascade 스크립트로 확장):
   ```bash
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
     psql -U diet -d diet -c "DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days';"
   ```
3. 백업은 7일 보관이므로 그 뒤에는 어디에도 남지 않는다.

## 7. 로그·관찰 (NFR-05)

- 컨테이너 로그는 json-file 드라이버, 파일당 10MB·5개로 순환. `docker compose logs -f api`.
- API 로그에 개인 식사 내용·토큰·비밀을 남기지 않는다. 로그인 실패는 사유 코드만(`kakao login failed: state_mismatch`).
- 확인 항목(주 1회): `df -h`(디스크), `docker stats --no-stream`(메모리, 2GB 기준), `docker compose ps`(재시작 횟수), `/api/v1/health`, 백업 로그, 월 예상 비용(공급자 콘솔).
- 메모리 실측(단계 0 완료 조건, 요구사항 §7-5). 2026-11-07 첫 배포 직후, 사용자 0명 유휴 상태의 `docker stats --no-stream`:

  | 컨테이너 | 메모리 | 비고 |
  | --- | --- | --- |
  | `diet-api-1` | 67 MiB | NestJS + Prisma |
  | `diet-caddy-1` | 56 MiB | 인증서 발급 직후 |
  | `diet-web-1` | 50 MiB | Next standalone |
  | `diet-db-1` | 46 MiB | PostgreSQL 18, 기본 설정 |
  | 합계 | 약 219 MiB / 1.86 GiB (12%) | CPU 0%. 스왑 2GB 별도 |

  유휴 기준이라 실사용·마이그레이션·백업 시점에 다시 재서 비교한다. 2GB 플랜은 여유가 충분하고 Next 정적 내보내기 대안(DEC-010)은 필요 없다.

## 8. 장애 대응

| 증상 | 확인 | 조치 |
| --- | --- | --- |
| 사이트 전체 불통 | `docker compose ps`, Caddy 로그 | `up -d`로 재기동. 인증서 발급 실패면 DNS·80/443 개방 확인 |
| `/health` 503 | DB 컨테이너 상태, 디스크 | DB 재기동. 디스크 가득이면 로그·백업 정리 |
| 로그인 실패(`/login?error=1`) | API 로그의 사유 코드 | `state_mismatch`: 쿠키 차단·오리진 불일치. `kakao_token_exchange_failed`: 카카오 콘솔의 Redirect URI·키 확인 |
| 배포 후 오류 | 이미지 태그, 마이그레이션 로그 | 이전 태그로 롤백(§4). 마이그레이션 실패면 복원 시험 DB에서 재현 |
| 서버 재시작 후 알림 폭주(단계 2) | `notification_delivery` pending | 설계상 오래된 pending은 skipped 처리. 발생하면 버그로 기록 |

## 9. 비용·도메인 (NFR-06)

- 월 환산 20,000원 상한. 확인 주기: 매월 1일 공급자 청구서 + 도메인 갱신일(연 1회) 캘린더 등록.
- 실제 금액(2026-11-07): Lightsail 월 12달러 + 도메인 연 11.17달러(월 환산 약 0.93달러) = 월 약 12.93달러. 환율 1,400원이면 약 18,100원으로 상한 안이지만 여유가 2천원 안쪽이라 환율·스냅샷·전송량 초과를 매월 확인한다(DEC-012). 도메인 선결제는 11월 한 달에 몰린다.
- 도메인 갱신: 자동 갱신 켜기, 만료 30일 전 알림. 등록기관 계정 2단계 인증.

## 10. 단계 1 상태 (2026-11-06)

- 완료: API §2·§3·§4·§6·§7·§8(완료 제외)·§9 전부, 마이그레이션 `phase1_core`, 단위 테스트 22건·e2e 27건 통과, 웹 화면 S-03·S-10~S-13·S-20~S-24·S-30~S-35·S-50·S-51·S-70, `next build`·SSR 스모크(모든 화면 200, 404·비로그인 307) 확인.
- 단계 2 로 넘긴 것: 하루 완료 API·S-14, 재고 현황·원장 화면·예측·보정(S-40~S-42), `POST /plans/overrides/batch/preview`, 통계·알림·PWA, 통계 탭, 알림 설정·계정 삭제 화면.
- 사용자 확인 필요: 실제 브라우저에서 각 화면의 조작(먹었음 1탭, 품목 수정, 영양 보완 다이얼로그, 받았음 처리, 캘린더 예외) — SSR 렌더만 자동 확인했고 클라이언트 조작은 e2e 범위 밖이다.

## 10-1. 단계 2 상태 (2026-11-08)

- 착수 전 질문 2개 닫힘(D-21 음수 재고, D-22 알림 한 체계).
- 완료: 하루 완료 API `GET/PUT/DELETE /days/{date}/completion` + `GET /days/{date}` 의 `completionCheck`(DEC-065), e2e 5건(`test/completion.e2e-spec.ts`). 웹 S-10 ⑧·S-14(`components/day/day-complete.tsx`), `next build` 통과. 브라우저에서의 다이얼로그 조작(아니오 → 안 먹음 저장, 완료 해제)은 사용자 확인 필요. e2e 파일은 한 DB 를 공유하므로 `jest.config.ts` 의 `maxWorkers: 1` 로 직렬 실행한다.
- 다음: 통계(`GET /stats/summary`·`/stats/daily`, S-60, 통계 탭) → 알림 → 재고 화면·예측·보정 → PWA (D-20 순서).

## 11. 단계 0 상태 (2026-11-05)

- 완료: 모노레포, 카카오 로그인(API 콜백·JWT 쿠키), 사용자 격리·CSRF·소프트 삭제, `/me`, `/health`, Swagger·OpenAPI 타입 생성, 마이그레이션, e2e 11건·단위 13건 통과, 로컬 API·웹 기동 확인, 실제 카카오 앱으로 로그인 확인(2026-11-05), Dockerfile·Compose·Caddyfile·CI·백업 스크립트 작성.
- 미완료(도메인·VM 구매 후): HTTPS 배포, 이미지 빌드(CI), 백업·복원 시험, 메모리 실측, 예산 견적 기록. Dockerfile·compose·백업 스크립트는 Docker가 없는 개발 PC에서 **실행해 보지 않았다**.

## 12. 첫 배포 결과 (2026-11-07)

- VM: Lightsail `ap-southeast-2`(시드니) 2GB, 고정 IP `16.179.16.224`. 서울 리전으로는 옮기지 않기로 함(사용자 결정, 2026-11-07). 한국→시드니 왕복 지연 약 130ms 는 감수한다.
- CD: run `42354235785`(커밋 `be5b0e3`)의 `deploy` job 이 secret 등록 뒤 Re-run 으로 성공. 이후 `main` push 마다 자동 배포.
- 외부 확인(2026-11-07 08:41 UTC): `/api/v1/health` → `{"status":"ok","db":"ok"}`, `/` → 307 `/login`, `http://` → 308 https, `www` → 301 apex, 인증서 Let's Encrypt(`CN=kkinilog.com`, 만료 2027-02-05, 자동 갱신), HSTS·nosniff 헤더 확인.
- 카카오 콘솔 운영 Redirect URI·플랫폼 등록 완료(2026-11-07). 메모리 실측은 §7 표.
- 남은 것: `scripts/backup.sh` 1회 + 복원 시험(§5), cron 등록. 이것이 끝나야 단계 0 완료 조건(배포·HTTPS·백업 복원 확인)이 닫힌다.
