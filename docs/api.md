# 식단·재고·체중 관리 웹앱 — API 목록 (1차 범위)

버전: v0.1 초안 (2026-11-03) / 근거: [`requirements-phase1.md`](requirements-phase1.md), [`erd.md`](erd.md), [`state-transitions.md`](state-transitions.md), [`screens.md`](screens.md), [`decisions.md`](decisions.md) DEC-025 / 전달 대상: Claude Code

루트 문서의 기능 요구(FR-01~09)·엔터티·상태 기계·화면을 **NestJS API 엔드포인트 단위**로 재배열했다. 경로·이름·요청 형식은 모두 **[제안]**이며 사용자 확정 사항이 아니다. 유일한 확정은 D-04의 `PUT /meal-records/{date}/{slot}` 상태 설정 방식이다. 확장 기능(OCR·사진 분석·크롤링·추천) API는 포함하지 않는다.

## 0. 공통 규칙 [제안]

- 접두사 `/api/v1`, JSON. 업무 규칙은 모두 이 API에 둔다(NFR-07). Next 서버는 화면만 담당한다.
- 인증은 카카오 OAuth 후 HttpOnly·Secure 세션 쿠키. 모든 리소스는 세션 사용자 범위로 강제한다(NFR-04). 요청 본문의 FK(제품·템플릿 ID)는 저장 전 소유자 검사로 거부한다.
- 날짜는 사용자 시간대(`User.timezone`, 기본 Asia/Seoul) 기준 `YYYY-MM-DD`. 시각은 ISO 8601 UTC(NFR-02).
- 슬롯 enum: `breakfast | lunch | dinner | afternoon_snack | evening_snack | extra`.
- 수량·영양은 소수 허용. `null`은 미상, `0`은 확인된 0. 서버는 반올림하지 않는다.
- 재고에 영향을 주는 쓰기 요청은 `Idempotency-Key` 헤더를 받는다. (user, key) 재전송은 저장된 응답을 그대로 돌려주고 재차감하지 않는다. 같은 키에 다른 본문이면 `422`(ERD A5).
- 식사 기록 쓰기는 `version`을 함께 보내고 불일치면 `409`(D-04).
- 상태 코드: 미인증 `401`, 검증 실패 `422`, 버전 충돌·덮어쓰기 확인 필요 `409`. 타인 리소스 응답(403/404)은 §12 미정.
- 날짜·슬롯의 계획은 저장하지 않고 `DateOverride` → `WeeklySchedule[weekday]` 순으로 계산하는 함수 하나를 둔다. 오늘 조회·소진 예측·완료 판정·알림 예약이 모두 이 함수를 쓴다(D-01).

## 1. 인증·계정 (단계 0) — FR-01, NFR-04, S-01~S-03, S-70, S-73

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /auth/kakao` | 카카오 로그인 시작. OAuth state 생성 후 리다이렉트 | 상태 전이 §7 |
| `GET /auth/kakao/callback` | state·허용 리다이렉트 검증, `User` upsert, 세션 쿠키 발급 | 실패 시 사유 없이 S-01로 |
| `POST /auth/logout` | 세션 폐기 | 로컬 임시 입력 삭제는 프런트 책임 |
| `GET /me` | 프로필·시간대·온보딩 완료 여부 | |
| `PATCH /me` | 닉네임·시간대 수정 | 시간대 변경 시 pending 알림 재예약 |
| `DELETE /me` | 계정 소프트 삭제(`deleted_at`) | 2단계 확인은 화면 책임. 개인 데이터 삭제 절차 문서화 필요 |
| `GET /health` | 상태 확인(비인증) | NFR-05 |

## 2. 목표 (단계 1) — FR-01, S-51

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /goals` | 목표 이력 목록. 현재 적용 중 표시 | |
| `POST /goals` | 새 목표 추가. `effective_from` 기본 오늘 | 이전 행은 보존(이력) |
| `GET /goals/effective?date=` | 특정 날짜에 적용되는 목표 | 그 날짜 이하 중 가장 늦은 행. 통계·오늘 화면도 같은 규칙 |

## 3. 제품·영양 (단계 1) — FR-02, D-02, D-03, S-30~S-33

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /products?q=&archived=` | 목록·검색. 영양 미등록·재고 비관리(소스) 배지 | |
| `POST /products` | 제품 등록. 선택 `initialStock`이 있으면 `StockReceipt(purchase_id=null)` + `StockMovement(initial)`을 같은 트랜잭션에서 생성 | 영양 정보 없이 저장 가능 |
| `GET /products/{id}` | 상세: 현재 영양 버전, 현재 재고·소진 예정, 구매 이력, 사용 중 템플릿 | |
| `PATCH /products/{id}` | 기본 정보 수정(`stock_unit`, `pack_weight_g`, `is_stock_tracked`, `default_serving_amount`, 링크 등) | 과거 스냅샷 불변 |
| `POST /products/{id}/archive` · `POST /products/{id}/unarchive` | 보관·복구 | |
| `GET /products/{id}/nutrition` | 영양 버전 목록(현재 + 이력) | |
| `POST /products/{id}/nutrition` | 새 버전 저장, 이전 버전 `superseded_at` 설정. 응답에 영양 미상 스냅샷 건수 포함 | D-03 1단계 |
| `POST /products/{id}/nutrition/backfill` | `kcal null`인 스냅샷만 현재 버전으로 채우고 출처 ‘사후 보완’·시각 기록 | D-03 2단계. 사용자 확인 후 호출. 값이 있는 스냅샷은 변경 안 함 |

## 4. 구매·입고 (단계 1) — FR-03, S-34, S-35

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /purchases?status=` | 배송 중(`ordered`)·입고 완료(`received`)·취소 목록 | 배송 중은 재고 미포함 표시 |
| `POST /purchases` | 구매 등록. `received: true`면 즉시 입고 처리 | Idempotency-Key |
| `PATCH /purchases/{id}` | `ordered` 상태에서만 수정 | |
| `POST /purchases/{id}/receive` | 받았음: `StockReceipt` + `StockMovement(receipt)` 생성 | 1 트랜잭션, Idempotency-Key |
| `POST /purchases/{id}/cancel` | `ordered`만 취소 | ERD enum `cancelled` |
| `POST /stock-receipts` | 구매 이력 없는 기존 보유분 초기 등록 | FR-03 제안. reason `initial` |

## 5. 재고·원장·소진 예측 (단계 2) — FR-03, FR-08, S-40~S-42

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /stock` | 제품별 현재 재고(`SUM(delta)`), 배송 중 수량 별도, 소진 예정일, 수준 배지(정상/소진 임박/소진/재고 확인 필요/예측 불가), 미기록 과거 식사가 있으면 ‘추정 신뢰도 낮음’ 플래그 | 음수는 0으로 자르지 않고 그대로 노출 |
| `GET /stock/{productId}` | 상세: 날짜별 예정 소비·입고 예정 등 예측 근거 | 오늘 이미 `eaten`인 슬롯은 예정량에서 제외 |
| `GET /stock/{productId}/movements?cursor=` | 원장 목록. 사유·시각·연결 식사 | 수정·삭제 API 없음(append-only) |
| `POST /stock/{productId}/adjustments` | 실측 잔량 보정·폐기·다른 용도 소비. `delta` 또는 `measuredQuantity`, `note` 필수 | reason `adjust | waste | other_use`. Idempotency-Key |

## 6. 식단 템플릿 (단계 1) — FR-04, S-20, S-21

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /meal-templates` | 목록. 1회 영양 합계(불완전 표시), 사용 중인 요일·슬롯 수 | |
| `POST /meal-templates` | 생성(`name`, `items[{productId, quantity, unit, sortOrder}]`) | 타인 제품 ID 거부 |
| `GET /meal-templates/{id}` | 상세 | |
| `PUT /meal-templates/{id}` | 이름·품목 전체 교체 | 과거 스냅샷 불변 |
| `POST /meal-templates/{id}/archive` · `.../unarchive` | 보관·복구 | |

## 7. 주간 반복·날짜 예외 (단계 1) — FR-04, D-01, S-22~S-24

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /plans/weekly` | 요일 7 × 슬롯 5 격자 | |
| `PUT /plans/weekly/{weekday}/{slot}` | 셀 단위 설정(`planType`, `templateId`) | `template`이면 `templateId` 필수 |
| `PUT /plans/weekly` | 격자 전체 교체(요일 복사용) | §12 미정 |
| `GET /plans/overrides?from=&to=` | 기간 내 예외 목록 | |
| `PUT /plans/overrides/{date}/{slot}` | 단일 예외 설정 | |
| `DELETE /plans/overrides/{date}/{slot}` | 예외 해제 → 반복 계획 복귀 | |
| `POST /plans/overrides/batch` | 기간·슬롯 일괄 변경(출장). `batch_id` 반환 | 유지할 슬롯은 제외 가능 |
| `DELETE /plans/overrides/batch/{batchId}` | 묶음 단위 해제 | |
| `POST /plans/overrides/batch/preview` | 적용 전 예정 소비 감소분·소진일 변화 계산(저장 없음) | S-24. 소진 예측 함수 재사용 |
| `GET /plans/resolved?from=&to=` | 날짜·슬롯별 적용 계획(예외 우선) | D-01 계산 함수를 그대로 노출 |

계획 변경은 기존 `MealRecord`를 수정하지 않는다(FR-04). 예외 등록·해제 시 소진 예측은 조회 시 재계산되고, 해당 슬롯의 pending 알림은 유형 변경·취소된다.

## 8. 날짜 요약·식사 기록·하루 완료 (기록 단계 1, 완료 단계 2) — FR-05, FR-06, D-01, D-04, S-10~S-14

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /days?from=&to=` | 캘린더·통계용 날짜별 요약: 완료 여부, 예외 유무, 외부 식사, 미기록 수 | S-23 |
| `GET /days/{date}` | 오늘 홈 한 번에: 계획 5슬롯 + 기록 상태, 영양 합계(기록/계획 포함 예상/해당 날짜 목표), 영양 누락 수, 추가 간식, 다음 식사, 체중, 완료 상태, 소진 임박 제품 | S-10. §12 미정(묶음 여부) |
| `GET /meal-records/{date}/{slot}` | 슬롯 상세. 레코드가 없으면 계산된 계획을 `status=unrecorded`, `version=null`로 반환 | 미래 레코드를 만들지 않음(D-01) |
| `PUT /meal-records/{date}/{slot}` | **상태 설정** `{status, kind, items[{productId, actualQuantity, unit}], outsideMenu, outsideNutrition, version}`. 서버가 이전 스냅샷과의 차이로 `consume_reverse(+)` 후 `consume(-)` 생성. 완료된 날이면 `DayCompletion` 해제. 해당 슬롯 pending 알림 `skipped`. 응답에 새 `version`과 `stock_check_needed` 항목 포함 | **확정(D-04, DEC-025)**. 1 트랜잭션, Idempotency-Key, 버전 불일치 `409`. 재고 부족이어도 저장을 막지 않음 |
| `POST /meal-records/{date}/extra` | 추가 간식 생성 | 같은 날 다건(ERD A7) |
| `PUT /meal-records/{date}/extra/{id}` · `DELETE .../extra/{id}` | 추가 간식 수정·삭제. 삭제 시 차감 전량 복구 | |
| `GET /days/{date}/completion` | 완료 가능 여부, 활성 슬롯 처리 현황, 미기록 목록, 영양 완전 여부 예측 | ‘계획 없음’ 슬롯 제외는 ERD A3 가정 |
| `PUT /days/{date}/completion` | 하루 완료. 활성 슬롯 미처리면 `422`. `nutrition_complete` 계산 저장 | 미래·가입 전 날짜 거부 |
| `DELETE /days/{date}/completion` | 완료 해제 | |

`PUT /meal-records` 처리 순서(ERD §4-1·4-2): `IdempotencyKey` 삽입 → `version` 비교 → `MealRecord` 상태·종류 갱신 → 기존 `MealItemSnapshot`의 `deducts_stock` 항목마다 `consume_reverse(+)` → 새 스냅샷 생성(현재 `ProductNutritionVersion` 복사) → `deducts_stock` 항목마다 `consume(-)` → `DayCompletion` 해제 → 알림 `skipped` → 응답 저장. 외부 식사 항목은 이동 0, `is_stock_tracked=false` 제품은 차감 제외.

## 9. 체중 (단계 1) — FR-07, S-50

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /weights?from=&to=` | 목록 + 요약(최근 7일 실측 평균·측정 횟수, 목표까지 차이, 주·월 변화) | 미측정일은 행 없음. 0으로 채우지 않음 |
| `PUT /weights/{date}` | 입력·수정. 같은 날 기록이 있으면 `overwrite: true` 없이는 `409` | 덮어쓰기 확인 |
| `DELETE /weights/{date}` | 삭제 → 미측정 | |

## 10. 통계 (단계 2) — FR-06, FR-07, S-60

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /stats/summary?from=&to=` | 기록 완료율(완료일/추적일), 연속 기록 일수, 영양 평균(유효일/전체일, 제외 이유: 미기록·영양 미상), 체중 요약, 계획 실천율(사전 변경 슬롯 분모 제외, 변경 시점) | 유효일 0이면 `null` + ‘데이터 없음’. 미래·가입 전 날짜 제외 |
| `GET /stats/daily?from=&to=` | PC 차트용 일별 영양·체중·완료 상태·당시 목표 시계열, 영양 불완전 날 목록 | 불완전 날의 합계는 ‘기록된 합계’로 표기 |

## 11. 알림·푸시 (단계 2) — FR-08, FR-09, NFR-05, S-71

| 메서드·경로 | 역할 | 비고 |
| --- | --- | --- |
| `GET /notification-settings` | 슬롯 5종 + 소진 알림 설정. 기본 모두 off | |
| `PUT /notification-settings/{kind}` | 종류별 on/off·시각·사전 분(0/10)·재알림 횟수·간격·소진 N일 | 변경 시 pending 재예약·취소 |
| `GET /push/public-key` | VAPID 공개키 | |
| `POST /push/subscriptions` | 구독 등록. `endpoint` 유니크, 재등록은 upsert | |
| `DELETE /push/subscriptions/{id}` | 구독 해제(`revoked_at`) | |
| `POST /push/test` | 현재 기기 테스트 발송 | screens §9-5 미정 |
| `GET /notifications?from=&to=` | 발송 이력·상태 조회 | 제안. 디버그·대체 안내용 |

### HTTP가 아닌 내부 작업(스케줄러)

- 당일 계획(D-01 함수)과 `NotificationSetting`으로 `NotificationDelivery(pending)` 생성. (user, type, target_date, slot, product_id) 유니크로 중복 차단.
- 예약 시각 도달 시 `PushSubscription`으로 발송. 실패는 `failed`, 재시도 중 중복 금지.
- 유형 ①(식사 체크) 발송 후 60분(설정값) 지나도 미기록이면 재알림 1회(설정값).
- 소진 임박 판정(예측 소진일 ≤ 오늘 + N일) 시 유형 ④ 예약.
- 서버 재시작 후 오래 지난 pending은 `skipped`. `IdempotencyKey` 만료분 정리.

## 12. 미정·결정 필요

문서에 답이 없어 구현 전에 정해야 할 항목. 괄호는 Claude Code 권고이며 사용자 미확정이다. 결정되면 `decisions.md`에 DEC-### 항목으로 올린다.

1. **타인 리소스 응답 코드**: 403 vs 404 (권고 404, 존재 여부 노출 방지. screens G-03의 ‘권한 없음’ 문구와 조정).
2. **`version` 형식**: ERD는 `updated_at` 비교를 말하지만 정수 컬럼이 단순하다 (권고 정수 `version` 추가, ERD 수정).
3. **오늘 홈 조회**: `GET /days/{date}` 하나로 묶을지, 슬롯·체중·재고를 따로 호출할지 (권고 묶음, 모바일 LCP 목표).
4. **주간 계획 저장 단위**: 셀 단위만 둘지 격자 전체 교체도 둘지 (권고 둘 다).
5. **추가 간식 식별**: `extra`는 (user, date, slot) 유니크가 아니므로 `id` 경로가 필요하다. 위 §8 형태로 둘지 확인.
6. **낙관적 잠금 범위**: D-04는 식사 기록만 명시한다. 템플릿·주간 계획·설정에도 적용할지 (권고 1차는 식사 기록만).
7. **D-03 보완 흐름**: 저장 응답에 건수를 싣고 별도 `backfill` 호출로 2단계 처리할지, 저장 요청에 `applyToUnknown` 플래그로 1단계 처리할지 (권고 2단계, S-33 확인 다이얼로그와 맞음).
8. **OpenAPI 문서**: NestJS Swagger로 자동 생성해 프런트 DTO를 공유할지 (권고 생성).
9. `POST /push/test`, `GET /notifications` 포함 여부 (screens §9-5와 연동).

## 13. 단계별 묶음

| 단계 | 엔드포인트 그룹 | 완료 조건(요구사항 §4 대응) |
| --- | --- | --- |
| 0 | §1 인증·계정, `/health` | HTTPS·카카오·사용자 격리(시나리오 7) |
| 1 | §2 목표, §3 제품·영양, §4 구매·입고, §6 템플릿, §7 주간·예외, §8 식사 기록(완료 제외), §9 체중 | 제품 B 등록·수동 영양·반복 식단·예외·실제 기록·일일 합계·체중(시나리오 1·2·3·4·5) |
| 2 | §5 재고·예측, §8 하루 완료, §10 통계, §11 알림·푸시, 내부 스케줄러 | 입고·차감·복구·예측, 하루 완료 통계, 대시보드, 알림(시나리오 6·8) |
