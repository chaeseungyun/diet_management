import type { components } from './api-types';

type Schemas = components['schemas'];
export type StockItem = Schemas['StockItemDto'];
export type DepletionChange = Schemas['DepletionChangeDto'];
export type MovementReason = Schemas['StockMovementDto']['reason'];

/** 서버 계산 범위와 같은 값. 목록 문구용으로만 쓴다 */
export const FORECAST_HORIZON_DAYS = 60;

type Forecast = Pick<StockItem, 'level' | 'depletionDate' | 'daysLeft' | 'beyondHorizon'>;

export const MOVEMENT_REASON_LABELS: Record<MovementReason, string> = {
  receipt: '받았음',
  initial: '현재 보유 등록',
  consume: '먹음',
  consume_reverse: '되돌림',
  adjust: '남은 양 맞춤',
  waste: '버림',
  other_use: '다른 데 씀',
};

/** '11/20' */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * 식품 카드의 남은 수량 아래 한 줄 (S-30, DEC-081): '6일 뒤 소진'.
 * 먹을 계획이 없거나 수량을 세지 않거나 다 먹었거나 음수인 식품은 null(배지가 따로 말한다).
 */
export function depletionShort(item: Forecast, horizonDays = FORECAST_HORIZON_DAYS): string | null {
  if (item.level !== 'imminent' && item.level !== 'ok') return null;
  if (item.daysLeft === null) return item.beyondHorizon ? `${horizonDays}일 넘게 충분` : null;
  return item.daysLeft === 0 ? '오늘 소진' : `${item.daysLeft}일 뒤 소진`;
}

/** 식품 상세의 남은 양 아래 한 줄 (S-32, DEC-081): '11월 20일에 떨어져요 · 6일 뒤' */
export function depletionLong(item: Forecast, horizonDays = FORECAST_HORIZON_DAYS): string | null {
  if (item.level !== 'imminent' && item.level !== 'ok') return null;
  if (item.depletionDate === null || item.daysLeft === null) {
    return item.beyondHorizon ? `${horizonDays}일 넘게 충분해요` : null;
  }
  const [, m, d] = item.depletionDate.split('-').map(Number);
  const when =
    item.daysLeft === 0 ? '오늘' : item.daysLeft === 1 ? '내일' : `${item.daysLeft}일 뒤`;
  return `${m}월 ${d}일에 떨어져요 · ${when}`;
}

/** 계획 변경 뒤 알림 문구: '떨어질 날이 바뀌었어요: 닭가슴살 11/20 → 11/23' (S-24, DEC-080 14) */
export function depletionChangeText(changes: readonly DepletionChange[]): string | null {
  if (changes.length === 0) return null;
  const day = (d: string | null) => (d ? shortDate(d) : '충분');
  const parts = changes.map((c) => `${c.name} ${day(c.before)} → ${day(c.after)}`);
  return `떨어질 날이 바뀌었어요: ${parts.join(', ')}`;
}
