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

/** 식사 슬롯 5종 + 추가 간식 (api.md §0, D-10) */
export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'dinner',
  'afternoon_snack',
  'evening_snack',
] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const EXTRA_SLOT = 'extra' as const;

/** 닉네임 길이 제한 (FR-01 최소 프로필) */
export const NICKNAME_MAX_LENGTH = 30;

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
