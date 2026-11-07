# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

단계 1 코드가 있다(2026-11-06; 단계 0 은 2026-11-05). pnpm 모노레포: `apps/web`(Next.js 16, Tailwind v4 + 디자인 토큰), `apps/api`(NestJS 11 **CommonJS**, Prisma 6, PostgreSQL 18), `packages/shared`(상수·순수 함수, CJS 빌드). 운영 문서는 `docs/ops.md`. 도메인·VM은 2026-11-06 구매 예정이라 배포·HTTPS·백업 복원 확인은 아직이다.

명령(저장소 루트에서):

- 준비: `pnpm install && pnpm --filter @diet/shared build && pnpm --filter @diet/api prisma:generate`. 환경 변수는 `apps/api/.env.example`, `apps/web/.env.example`를 복사.
- 로컬 DB: `pnpm db:dev`(embedded-postgres, 127.0.0.1:54320, Docker 불필요) → `pnpm --filter @diet/api prisma:deploy`.
- 실행: `pnpm --filter @diet/api dev`(:4000, Swagger `/api/v1/docs`), `pnpm --filter @diet/web dev`(:3000, `/api/*`를 :4000으로 rewrite). 브라우저는 항상 :3000.
- 검사: `pnpm typecheck`, `pnpm test`(API e2e는 DB를 자동으로 띄움). 단일 테스트: `pnpm --filter @diet/api exec jest --selectProjects unit -t "<이름>"`, e2e만: `pnpm --filter @diet/api test:e2e`.
- 빌드: `pnpm build`. API 타입 재생성: `pnpm --filter @diet/api openapi:export && pnpm --filter @diet/web api-types`(`openapi.json`·`api-types.d.ts` 둘 다 커밋, CI가 검사).
- 린트: 미도입(ESLint 는 단계 2 착수 시 검토). Prettier는 `pnpm format:check`.
- 단계 1 구조: API 모듈 `goals`·`products`(영양·backfill 포함)·`purchases`(stock-receipts 포함)·`templates`·`plans`·`meals`(days·meal-records·extra)·`weights`. 순수 계산은 `src/domain/`(units·nutrition·plan·dates), 공통은 `src/common/`(idempotency·validators·nutrition.dto). 웹은 `src/app/(app)/`(로그인 영역), `src/components/{day,products,plans,settings,ui,shell}`. DB 제약은 Prisma 로 표현 가능한 것만(DEC-055).

코드 규칙:

- `apps/api`는 CommonJS + Jest다. ESM 전용 패키지(NestJS 12, jose, cookie v2 등)를 넣지 않는다(DEC-047·049). 런타임 의존성을 늘리기 전에 node 내장으로 되는지 본다.
- 스키마 변경: `apps/api/prisma/schema.prisma` 수정 → 로컬 DB 띄운 뒤 `pnpm --filter @diet/api prisma:migrate --name <이름>` → 생성 SQL 검토(NULLS NOT DISTINCT 같은 수동 SQL은 파일에 직접) → 커밋. 테이블은 snake_case 복수형, 모델·필드는 camelCase(DEC-052).
- 새 리소스는 `findFirst({ where: { id, userId } })` 결과가 없으면 404 다(`ProductsService.loadOwned` 패턴). 본문의 FK(제품·템플릿 ID)도 소유 검사로 404. 재고에 영향을 주는 쓰기는 `IdempotencyService.run` 안에서 하고, 식사 기록 쓰기는 version 조건부 갱신으로 행을 잠근 뒤 원장을 만든다(DEC-055). `OriginGuard`(CSRF)·`AuthGuard`가 전역이며 공개 엔드포인트만 `@Public()`.
- 환경 변수는 `src/config/env.ts`의 zod 스키마에 추가하고 `.env.example`과 `deploy/docker-compose.yml`을 함께 갱신한다. 비밀 값은 로그·응답에 싣지 않는다.
- 웹에서 API 호출은 `src/lib/api.ts`(서버)·같은 오리진 `fetch('/api/v1/…')`(클라이언트)만. 업무 규칙을 Next 쪽에 두지 않는다.

## 문서 지도와 우선순위

설계 문서는 모두 `docs/` 아래에 있다. 문서 간 상대 링크는 `docs/` 기준이며, 아래 본문에서 파일명만 적은 것은 `docs/` 안의 파일을 가리킨다.

| 문서 | 역할 |
| --- | --- |
| `docs/requirements-phase1.md` | 1차 범위(단계 0~2)의 NFR/FR, 인수 시나리오, **§6 설계 결정(D-01~D-15, 사용자 확정)**, §7 검토 메모(미정) |
| `docs/erd.md` | 엔터티 속성·관계, 핵심 흐름→테이블 매핑(§4), 설계 전제(§5, 제안) |
| `docs/state-transitions.md` | 개체별 상태 기계, 미정 전이 목록(§10), ERD enum 대응표(§12) |
| `docs/screens.md` | 화면 ID(S-xx)·경로·데이터·단계별 묶음(§8), 화면별 상태 표시 규칙(§7), 미정(§9) |
| `docs/api.md` | API 엔드포인트 목록(§1~§11, 모두 제안), 공통 규칙(§0), 미정(§12), 단계별 묶음(§13). 확정은 D-04의 `PUT /meal-records/{date}/{slot}`, 404(D-06), JWT 쿠키(D-07), 정수 `version`(D-08), `extra` 경로(D-10) |
| `docs/design-tokens.md` | 컬러 토큰(`docs/design/globals.css`, Claude Design 생성)의 shadcn/ui(Tailwind v4) 적용 방법, 도메인 상태↔토큰 매핑, 컴포넌트 variant 확장, 대비 검토. 값은 CSS 파일이 기준 |
| `docs/extension-todo.md` | 단계 3 이후(OCR·사진 분석·크롤링·LLM 추천). **1차 구현 중에는 만들지 않는다** |
| `docs/food-db-plan.md` | 공공데이터 음식 DB 계획(제안, DEC-058). 전역 읽기 전용 테이블 + 사용자 선택 복사. 단계 2 뒤 배치 권고 |
| `docs/decisions.md` | 결정 기록(DEC-###). 결정의 맥락·버린 대안·근거·재검토 조건. 상태 확정/제안/미정/대체됨. 열린 결정은 §F, 구현 단계 결정은 §H |
| `docs/ops.md` | 운영 문서: 로컬 실행, 검증 명령, 배포 절차, 백업·복원, 계정 삭제, 로그·장애 대응, 비용 |
| `docs/archive/diet-app-requirements-v0.1.md` | 분리 전 원본. 참고용, 수정하지 않는다 |

규칙:

- 문서의 **확정 / 제안 / 미정** 표기를 구분한다. 제안·미정을 사용자 확정 사항으로 기록하거나 구현 전제로 굳히지 않는다. 기술 선택·수치 목표(p95, LCP, 예산 배분)는 제안이다.
- FR 본문과 §6 설계 결정이 충돌하면 §6이 우선한다.
- 미정 항목은 `requirements-phase1.md` §7, `erd.md` §5 하단, `state-transitions.md` §10, `screens.md` §9, `api.md` §12에 모여 있다. 새 미정 사항은 해당 목록에 추가하고, 결정되면 §6 형식(D-xx)으로 올린다.
- 결정 기록은 `decisions.md`에 남긴다. 구현 중 내린 결정(라이브러리 선택, 스키마 변경, 설계 변경)은 나중에 몰아 쓰지 말고 커밋·PR 링크와 함께 바로 `DEC-###` 항목으로 추가한다. 번호는 재사용하지 않고, 뒤집힌 결정은 지우지 않고 `대체됨`으로 바꾼다. `decisions.md`와 요구사항 문서가 충돌하면 요구사항 문서가 우선하고 `decisions.md`를 고친다.
- 문서 간 링크(마크다운 상대 경로)와 ID(FR-xx, NFR-xx, D-xx, S-xx, EXT-xx, A1~A8)를 유지한다. 문서는 한국어로 쓴다.
- 이 저장소는 구매·주문·결제를 지시하지 않는다. 유료 인프라·도메인은 실제 결제액 검토가 가능한 상태만 만든다.

## 여러 문서에 걸친 핵심 설계 불변식

코드를 쓸 때 반드시 지켜야 하는 것들. 출처를 괄호로 표시했다.

- **계획은 저장하지 않고 계산한다 (D-01).** 날짜·슬롯의 계획 = `DateOverride`가 있으면 그것, 없으면 `WeeklySchedule[weekday]`. `MealRecord`는 사용자가 체크·수정할 때만 생성하며 미래 레코드를 미리 만들지 않는다. 소진 예측(FR-08)·알림(FR-09)·통계(FR-06)·‘미기록’ 판정이 모두 같은 계산 함수를 쓴다.
- **식사 상태 변경과 재고 변경은 한 트랜잭션 (NFR-02, erd §4-1).** API는 델타가 아니라 상태 설정: `PUT /meal-records/{date}/{slot}` + `{status, items[], version}`. 서버가 이전 스냅샷과의 차이로 `StockMovement`를 만든다. `version`(정수 컬럼, 쓰기마다 +1, D-08) 불일치는 409. `IdempotencyKey`(user, key) 재전송은 저장된 응답을 돌려주고 재차감하지 않는다.
- **재고 원장은 append-only (erd §3).** 현재 재고 = `SUM(StockMovement.delta)`. 수정·취소는 `consume_reverse(+)`로 전량 복구 후 `consume(-)` 재차감. 음수 합계를 허용하고 0으로 자르지 않는다. 배송 중(`Purchase.status=ordered`)은 재고에 합산하지 않는다.
- **식사 상태는 3개뿐이고 3×3 전이 전부 허용 (D-04).** unrecorded / eaten / skipped. ‘취소’ = unrecorded로 설정. ‘다르게 먹음’은 상태가 아니라 수정 동작. 완료된 날(`DayCompletion`)에서 수정·취소가 일어나면 완료를 해제한다.
- **과거 스냅샷은 불변 (NFR-02).** `MealItemSnapshot`에 당시 제품명·수량·영양을 복사한다. 제품·템플릿 변경은 과거 합계를 바꾸지 않는다. 유일한 예외는 D-03: 영양 **미상(null)** 스냅샷만 사용자 확인 후 채우고 출처 ‘사후 보완’을 남긴다.
- **재고 단위와 환산 (D-02, D-11, D-13).** 제품마다 `stock_unit`(g/ml/ea), ea 제품은 표시용 `unit_label`(팩·개·통), 포장 1개당 재고 단위 수 `units_per_package`(입고 = 구매 수량 × N), 선택적 `pack_weight_g`(ea 1단위의 g). ea↔g 변환은 `pack_weight_g`가 있을 때만. 영양 기준 단위는 제품 `stock_unit`과 같거나 g뿐이고 `serving`은 없다. 원장 이동이 있는 제품의 `stock_unit` 변경은 422로 거부한다. 수량·영양 컬럼은 `numeric`(소수 허용), 반올림은 화면에서만. 영양 기준량과 실제 섭취량을 분리한다(“가루 45g ≠ 단백질 45g”).
- **null은 미상, 0은 확인된 0.** 외부 식사 영양 미입력은 null. ‘안 먹음’은 섭취 0, ‘미기록’은 미상. 주간·월간 평균은 완료 + 영양 완전인 날만 포함하고 유효일 0일이면 ‘데이터 없음’. 메뉴명으로 영양을 자동 계산하는 척 하지 않는다.
- **사용자 격리 (NFR-04).** 모든 사용자 데이터 테이블에 `user_id`. 모든 조회·수정은 토큰 사용자로 강제하고, 타인 소유 FK(예: `template_id`)는 저장 전 소유자 검사로 거부한다. 타인 리소스 ID 요청은 존재 여부와 무관하게 **404**이며 403은 쓰지 않는다 (D-06).
- **인증은 stateless JWT (D-07).** 서버가 서명한 JWT를 HttpOnly·Secure·SameSite 쿠키에 담는다. DB 세션 테이블·Redis 등 서버 세션 저장소를 만들지 않는다. 로그아웃 = 쿠키 삭제. 카카오 콜백은 API(`/api/v1/auth/kakao/callback`)가 받아 쿠키 발급 후 웹 `/`로 302 하며 웹 처리 화면은 없다 (D-14). 웹·API는 같은 오리진이고 `/api/*`만 NestJS로 보낸다(운영 Caddy, 개발 Next rewrite). 개발 중 카카오 리다이렉트는 `localhost`.
- **알림 중복 방지 (D-12).** `NotificationDelivery` 유니크는 `NULLS NOT DISTINCT`(PostgreSQL 15+, 원시 SQL 마이그레이션). 식사 취소로 미기록이 되면 새 행을 만들지 않고 `skipped` 행을 `pending`으로 되돌린다.
- **시각은 `timestamptz`(UTC), 식사·체중·완료 날짜는 사용자 시간대 기준 `date`로 별도 저장.** 기본 시간대 Asia/Seoul.
- **업무 로직은 NestJS API에만 둔다 (NFR-07).** Next 서버에 재고·식단 규칙을 중복하지 않는다.
- **소스(sauce)는 `Product.is_stock_tracked=false`** 플래그로 재고 차감 제외 (D-09). 선택적 `default_serving_amount`로 계산한 영양의 출처는 `manual_estimate`.
- **'계획 없음'(`none`)은 자유 끼니 (D-18).** 화면 문구는 '자유 끼니'. 미기록 자유 끼니만 완료·통계·예상에서 제외하고, 먹었음·안 먹음으로 기록하면 포함한다. `User.activeSlots`에 없는 끼니는 오늘 화면·격자에서 숨기되 기록이 있는 날에는 보인다. 날짜 예외는 캘린더와 S-11 양쪽에서 만든다.
- **추가 간식은 `slot=extra`, `id`로 식별 (D-10).** 정규 5슬롯만 (user, date, slot) 유니크. `extra`는 완료 판정의 활성 슬롯에서 제외하고 영양 합계에는 포함한다.

## 구현 순서

단계 0(로그인·배포·사용자 격리) → 1(제품·식단·기록·체중 + 구매·입고·섭취 차감·복구 원장 API, D-15) → 2(재고 화면·예측·보정·완료 통계·대시보드·알림·PWA). 화면 묶음은 `screens.md` §8, 완료 조건은 `requirements-phase1.md` §4. 정합성·격리·스냅샷·백업 복구를 UI 장식보다 먼저 검증한다. D-03 보완 흐름은 2단계로 확정됐다(D-16). '계획 없음' 슬롯은 자유 끼니로 확정됐다(D-18: 미기록만 집계 제외, 쓰는 끼니는 `User.activeSlots`). 단계 2 착수 전에는 음수 재고 예측 표시와 알림 체계 공유 여부를 묻는다(`decisions.md` §F). 핵심 테스트 대상: 사용자 격리, 단위 변환, 재고 트랜잭션·중복 요청·복구, 날짜 예외, 과거 기록 보존, 미기록 통계 제외.

## 저장소 관례

- 커밋 메시지는 한국어, 접두사는 `docs:` / `chore:` 등 Conventional Commits 형식.
- `.gitattributes`로 모든 텍스트 파일을 LF로 고정한다(`.bat`/`.cmd`/`.ps1`만 CRLF).
- 샘플 제품 데이터를 실제 사용자 데이터로 등록하지 않는다. 개인 식단을 기본값으로 하드코딩하지 않는다.
