/**
 * @diet/shared — 웹·API가 공유하는 상수와 순수 함수.
 * 업무 규칙(재고·식단 계산)은 여기 두지 않는다(NFR-07). API 응답 타입은 OpenAPI 산출물에서 생성한다(D-05).
 */

/** API 접두사 (api.md §0) */
export const API_PREFIX = '/api/v1';

/** 사용자 기본 시간대 (NFR-02, D-21) */
export const DEFAULT_TIMEZONE = 'Asia/Seoul';

/** 인증 쿠키 이름 (D-07) */
export const SESSION_COOKIE = 'session';

/** 식사 슬롯 5종, 하루 순서대로 (api.md §0). 추가 간식은 EXTRA_SLOT (D-10) */
/** 하루 끼니(extra 제외). 사용자가 설정에서 쓰는 끼니를 고른다 (D-18) */
export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'afternoon_snack',
  'dinner',
  'evening_snack',
] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const EXTRA_SLOT = 'extra' as const;
export type AnySlot = MealSlot | typeof EXTRA_SLOT;

export const SLOT_LABELS: Record<AnySlot, string> = {
  breakfast: '아침',
  lunch: '점심',
  afternoon_snack: '오후 간식',
  dinner: '저녁',
  evening_snack: '저녁 간식',
  extra: '추가 간식',
};

/** 재고·섭취·영양 기준 단위 (D-02, D-11) */
export const STOCK_UNITS = ['g', 'ml', 'ea'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const PLAN_TYPES = ['template', 'outside', 'none'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  template: '식단',
  outside: '외부 식사',
  none: '자유 끼니',
};

export const MEAL_STATUSES = ['unrecorded', 'eaten', 'skipped'] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];
export const MEAL_STATUS_LABELS: Record<MealStatus, string> = {
  unrecorded: '미기록',
  eaten: '먹었음',
  skipped: '안 먹음',
};

export const MEAL_KINDS = ['home', 'outside'] as const;
export type MealKind = (typeof MEAL_KINDS)[number];

export const NUTRITION_SOURCES = ['label', 'manual_estimate', 'ai_estimate'] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];
export const NUTRITION_SOURCE_LABELS: Record<NutritionSource | 'backfill', string> = {
  label: '포장 표시값',
  manual_estimate: '직접 입력 추정',
  ai_estimate: 'AI 추정',
  backfill: '사후 보완',
};

export const PURCHASE_STATUSES = ['ordered', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  ordered: '배송 중',
  received: '받았음',
  cancelled: '취소',
};

/** ISO 요일 1=월 … 7=일 (요구사항 §7-7) */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
  6: '토',
  7: '일',
};

/** 닉네임 길이 제한 (FR-01 최소 프로필) */
export const NICKNAME_MAX_LENGTH = 30;
export const NAME_MAX_LENGTH = 100;
export const NOTE_MAX_LENGTH = 500;

/** 멱등성 키 헤더 (api.md §0) */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** YYYY-MM-DD */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 달력에 존재하는 YYYY-MM-DD 인지 검사한다. */
export function isValidDateString(s: string): boolean {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** IANA 시간대 문자열인지 검사한다. 런타임의 ICU 데이터를 기준으로 한다. */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 주어진 시간대의 오늘 날짜(YYYY-MM-DD). 서버 UTC 와 사용자 날짜 경계를 구분한다(NFR-02). */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 표시용 수량. 소수 3자리까지, 뒤 0 제거. 화면에서만 반올림한다(NFR-02). */
export function formatQuantity(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Number(n.toFixed(digits)).toString();
}

/** 식품의 표시 단위: g/ml 는 그대로, ea 는 unit_label(팩·개·통) (D-11) */
export function displayUnit(p: { stockUnit: StockUnit; unitLabel: string | null }): string {
  return p.stockUnit === 'ea' ? (p.unitLabel ?? '개') : p.stockUnit;
}
