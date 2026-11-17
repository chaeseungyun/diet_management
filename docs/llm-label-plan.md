# 단계 5 — LLM 영양성분표 읽기 계획

상태: **방향 확정**(DEC-099: OCR 대신 LLM, 사용자 확인 후 저장). 이 문서의 세부(모델·한도·API 모양·화면)는 **제안**이며 구현하면서 DEC 로 확정한다. 요구는 [`extension-todo.md`](extension-todo.md) EXT-01 과 "확장 공통 요구사항"이 기준이다.

## 1. 목표와 범위

- 식품 영양 입력 화면(S-33, `/products/{id}/nutrition`)에서 **성분표 사진·캡처를 올리면 기준량·kcal·탄수화물·단백질·지방을 폼에 채운다.** 사용자가 확인·수정한 뒤 기존 '저장' 으로 새 영양 버전을 만든다. 출처는 `label`(성분표).
- 식품을 새로 등록하면 이미 S-33 으로 이어지므로(`next=nutrition`) 초기 등록에서 바로 쓴다.
- 범위 밖: 제품명·브랜드 자동 등록, 당류·나트륨 등(스키마에 칸이 없다), 한 끼에 여러 성분표 합산(DEC-099), 음식 사진 추정(단계 6).

## 2. 흐름

1. 웹: '성분표 사진으로 채우기' → 파일 선택(카메라·앨범·캡처) → `POST /products/{id}/nutrition/label-read`(multipart).
2. API: 소유 검사(남의 제품 404) → 형식·크기 검사(JPEG·PNG·WebP, 10 MB, 사진 업로드와 같은 규칙) → `sharp` 로 긴 변 1600 px·EXIF 제거(메모리에서만, **디스크에 저장하지 않는다**).
3. 한도 검사와 비용 예약(§5) → LLM 호출(타임아웃 30초, 재시도 없음) → JSON 스키마 응답 검증.
4. 서버가 기준을 고르고 값을 바꾼다(§3) → 초안 응답. **DB 의 영양 정보는 바꾸지 않는다.**
5. 웹: 초안을 폼에 채우고 채운 칸·경고를 보여 준다. 저장은 사용자가 한다.

요청 안에서 끝낸다(작업 ID·워커 없음). 이유와 확장 공통 요구사항과의 차이는 §10.

## 3. 기준량 해석 (서버, 순수 함수 `domain/label`)

성분표에는 기준이 여러 열로 섞여 있다(100 g당·1회 제공량당·총 내용량당). LLM 은 **보이는 열을 모두** 돌려주고, 어느 열을 쓸지는 서버 규칙이 정한다.

LLM 출력(구조화 출력, JSON 스키마 strict):

```
isNutritionLabel: boolean
columns: [{ basis: per_100 | per_serving | per_total | other,
            amount: number|null, unit: g|ml|null,      // 그 열의 기준량
            kcal, carbG, proteinG, fatG: { value: number|null, qualifier: exact | less_than | unreadable } }]
servingSize: { amount, unit } | null
totalContent: { amount, unit } | null
```

추천 열 규칙(제품 `stock_unit` 에 맞춘다, D-11):

| 제품 단위 | 추천 | 없으면 |
| --- | --- | --- |
| g | 100 g당 → basis 100 g | 1회 제공량(g) → 그 g 그대로 |
| ml | 100 ml당 → basis 100 ml | 1회 제공량(ml) |
| ea | 총 내용량이 1개(1 단위)일 때 그 열 → basis 1 ea | `pack_weight_g` 가 있으면 g 열 → basis g(허용, D-02). 없으면 사용자가 고른다 |

- 열이 여러 개면 응답에 모두 싣고 `recommended` 를 표시한다. 화면에서 바꿀 수 있다.
- **'1 g 미만'(`less_than`)·읽을 수 없음·없는 칸은 null(미상)로 두고 경고**한다(EXT-01: 임의의 확정값으로 바꾸지 않는다). 예: "지방이 '1 g 미만' 이라 비워 뒀어요. 0 으로 둘지 직접 정해 주세요".
- 검산: `|kcal − (4×탄수화물 + 4×단백질 + 9×지방)| > max(15 %, 10 kcal)` 이면 경고(식이섬유·당알코올 등으로 어긋날 수 있어 막지는 않는다).
- `isNutritionLabel=false` 거나 쓸 수 있는 열이 없으면 `422 LABEL_UNREADABLE`.

## 4. 제공자·모델

- **기본 후보: OpenAI `gpt-6-luna`**. `gpt-4.1-mini` 는 2027-01-14 API 종료 예정이라 제외(DEC-099). 공식 단가: 입력 $0.10 / 출력 $0.50(100만 토큰당), 이미지 입력 지원.
- **SDK 를 넣지 않고 `fetch` 로 직접 호출**한다(API 는 CommonJS, 런타임 의존성을 늘리기 전에 내장으로 되는지 본다). 구조화 출력(JSON 스키마)과 이미지 입력을 함께 쓰는 요청 형식은 구현 때 공식 문서로 확인한다.
- 제공자를 `LabelReader` 인터페이스 뒤에 둔다(확장 공통 요구사항: 교체 가능). e2e 는 가짜 리더(`PushSender` 처럼 provider 교체)로 돈다.
- **확정은 §8 평가 뒤**. 기준을 넘지 못하면 같은 표본으로 상위 모델이나 다른 제공자를 비교한다.

## 5. 비용·한도

- 예상: 사진+지시문 입력 약 2,000 토큰, 출력 약 400 토큰 → 호출당 약 $0.0004(약 0.6원). 월 AI 예산 3,000원이면 수천 번이라 예산은 실제 제약이 아니라 **버그·키 유출 방어선**이다.
- 새 테이블 `ai_usages`: user, feature(`nutrition_label`), model, status(`reserved|succeeded|failed`), reserved_krw, cost_krw, input/output 토큰, latency_ms, 오류 코드, created_at.
- 호출 전 **예약**: 이번 달(Asia/Seoul) 합계(확정 비용 + 남은 예약) + 이번 상한 비용 ≤ `AI_MONTHLY_BUDGET_KRW` 를 트랜잭션 + 잠금으로 확인한다(동시 요청도 넘지 못한다). 상한 비용 = 최대 입력(이미지 크기 상한) + `max_output_tokens` 로 계산. 끝나면 실제 사용량으로 정산, 실패는 응답에 사용량이 있으면 그만큼만.
- 사용자당 하루 횟수 상한 `AI_DAILY_LIMIT_PER_USER`(기본 20). 넘으면 `422 AI_DAILY_LIMIT`, 월 예산이면 `422 AI_BUDGET_EXCEEDED`. 둘 다 "직접 입력은 그대로 할 수 있어요" 로 안내.
- 제공자 대시보드에도 월 사용 한도를 건다(사용자가 직접, `ops.md` 에 절차). 서버 한도와 이중 방어.
- `ai_usages` 는 13개월 보관 뒤 매일 정리 작업이 지운다(공급자 내역과 대조할 기간).

## 6. API (제안)

| 메서드·경로 | 설명 | 비고 |
| --- | --- | --- |
| `GET /ai/status` | `{ labelRead: boolean, remainingToday: number }` | 키가 없거나 예산 초과면 `labelRead=false` → 버튼 숨김·비활성 |
| `POST /products/{id}/nutrition/label-read` | multipart `file` → `NutritionLabelDraftDto { columns[{basisAmount, basisUnit, kcal, carbG, proteinG, fatG, label}], recommended, warnings[{code, field?}] }` | 남의 제품 404. 저장하지 않음. 멱등 키 불필요(상태 변화는 사용량 기록뿐) |

새 오류 코드(`@diet/shared` `ERROR_CODES` + 웹 `error-messages.ts`): `AI_UNAVAILABLE`(503, 키 없음), `AI_DAILY_LIMIT`·`AI_BUDGET_EXCEEDED`·`LABEL_UNREADABLE`(422), `AI_UPSTREAM`(502, 제공자 오류·타임아웃). 사진 형식·크기는 기존 사진 오류 코드를 쓴다.

## 7. 화면 (S-33)

- 상단에 '성분표 사진으로 채우기'(가능할 때만). 밑에 한 줄: "사진은 저장하지 않고, 읽기 위해 OpenAI 로 보내요".
- 읽는 중 표시(수 초) → 채운 칸 강조, 기준이 여러 열이면 "어느 기준으로 채울까요?" 선택, 경고 목록. 출처는 '성분표' 로 둔다.
- 실패하면 오류 문구만 보이고 폼은 그대로(직접 입력).

## 8. 평가 (EXT-01 평가 요구 + 모델 확정)

- 표본: 사용자 제품의 성분표 사진·캡처 **15~20장**(100 g당·1회 제공량·총 내용량, 가로형·세로형, 촬영·캡처를 섞는다). 정답은 손으로 적은 JSON.
- 사진은 저장소에 커밋하지 않는다(`apps/api/eval/labels/`, `.gitignore`). 결과는 집계만 이 문서에 남긴다.
- 스크립트 `pnpm --filter @diet/api eval:label`: 실제 리더로 돌려 필드별 정확도(정답과 일치, 소수 반올림 차이 허용), 추천 기준 정확도, 지연 p50·p95, 호출당 비용을 낸다. 지시문·모델을 바꾸면 다시 돌린다(회귀).
- 채택 기준(제안): 필드 정확도 95 % 이상, 기준 선택 오류 0건. 넘으면 `gpt-6-luna` 확정 DEC.

## 9. 테스트

- 단위(`domain/label`): g·ml·ea(+`pack_weight_g`) 추천 규칙, '1 g 미만' → null + 경고, 검산 경고, 쓸 열이 없을 때.
- e2e(가짜 리더): 남의 제품 404, 키 없음 `AI_UNAVAILABLE`, 하루 상한, 월 예산 차단(예약 포함, 동시 두 요청 중 하나만 통과), 제공자 실패·타임아웃 → `AI_UPSTREAM` 과 예약 해제, 잘못된 JSON → `LABEL_UNREADABLE`, 응답 뒤 영양 정보가 바뀌지 않음, 사진 파일이 남지 않음.

## 10. 확장 공통 요구사항과 다른 점 (구현 때 DEC)

- **작업 ID·워커·Python 워커 없이 요청 안에서 처리**: 사진 한 장, 수 초, 사용자가 폼 앞에서 기다리고, 저장할 상태가 없어 실패해도 복구할 작업이 없다. 단계 6(음식 사진, 기록 저장과 엮임)에서 다시 판단한다.
- 엔터티는 `AIUsage` 만 도입한다(`AnalysisJob`·`ProductSourceSnapshot` 은 필요할 때).

## 11. 환경 변수

`OPENAI_API_KEY`(선택, 없으면 기능 꺼짐), `AI_LABEL_MODEL`(기본 `gpt-6-luna`), `AI_MONTHLY_BUDGET_KRW`(3000), `AI_DAILY_LIMIT_PER_USER`(20), `AI_KRW_PER_USD`(비용 환산, 보수적으로 높게), `AI_TIMEOUT_MS`(30000). env.ts zod·`.env.example`·`deploy/docker-compose.yml` 함께. 키는 로그·응답에 싣지 않는다.

## 12. 나누기

- **5a — API + 평가**: `domain/label`, `LabelReader`(OpenAI `fetch`), `ai_usages` 마이그레이션·예약·정산, 두 엔드포인트, 오류 코드, e2e, 평가 스크립트 → 표본으로 모델 확정.
- **5b — 웹**: S-33 버튼·기준 선택·강조·경고, 안내 문구. 실기기(촬영·캡처) 확인은 배포 뒤.

## 13. 미정 (사용자 확인 필요)

1. 평가 표본 15~20장을 준비할 수 있는가(사진은 저장소 밖에 둔다).
2. OpenAI API 키 발급·결제 수단·대시보드 월 한도 설정은 사용자가 직접 한다. 한도 값은?
3. 하루 상한 20회, 월 예산 3,000원 그대로 둘지.
