/**
 * 소진 예측 (FR-08, D-01, D-18, D-21, DEC-080). DB 를 모르는 순수 함수.
 * - 예측 = 현재 재고 − 앞으로 먹을 양. 계획은 저장하지 않고 PlanResolver 로 계산한다.
 * - 소진일 = 남은 양으로 필요량을 다 채우지 못하는 첫 식단 끼니의 날짜.
 * - 오늘 먹었음(원장에서 이미 차감)·안 먹음(먹지 않음) 끼니는 앞으로 먹을 양에서 빼고,
 *   오늘 미기록 식단 끼니는 시각이 지났어도 넣는다. 쓰지 않는 끼니는 뺀다.
 * - 음수는 '재고 확인 필요' 일 뿐 예측하지 않는다(D-21).
 */
import type { MealSlot, StockUnit } from '@prisma/client';
import { MEAL_SLOTS } from '@diet/shared';
import { addDays, daysBetween, eachDate, isoWeekday, type DateString } from './dates';
import type { PlanResolver } from './plan';
import { Decimal, toStockUnit, type UnitProduct } from './units';

/** 오늘을 포함해 며칠을 계산하는가 */
export const FORECAST_HORIZON_DAYS = 60;
/** '추정 신뢰도 낮음' 판정이 거슬러 올라가는 최대 일수 */
export const LOW_CONFIDENCE_LOOKBACK_DAYS = 90;

/** 수준 배지. 우선순위 순서 그대로다 (DEC-080 7) */
export const STOCK_LEVELS = [
  'untracked',
  'check_needed',
  'depleted',
  'unpredictable',
  'imminent',
  'ok',
] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

export interface ForecastItem {
  productId: string;
  quantity: Decimal;
  unit: StockUnit;
}

export interface ForecastProduct extends UnitProduct {
  id: string;
  isStockTracked: boolean;
  /** SUM(delta), stock_unit 기준. 음수 그대로 */
  currentStock: Decimal;
}

export interface PlanContext {
  today: DateString;
  activeSlots: readonly MealSlot[];
  resolver: PlanResolver;
  /** 템플릿 ID → 품목 */
  templateItems: ReadonlyMap<string, readonly ForecastItem[]>;
}

export interface ForecastInput extends PlanContext {
  horizonDays?: number;
  /** 소진 임박 기준 N일 (소진 알림 설정과 같은 값) */
  daysBefore: number;
  products: readonly ForecastProduct[];
  /** 오늘 먹었음·안 먹음으로 기록한 정규 끼니 */
  recordedToday: ReadonlySet<MealSlot>;
}

export interface PlannedConsumption {
  date: DateString;
  /** 그 날 예정 소비 합, stock_unit 기준 */
  quantity: Decimal;
}

export interface ProductForecast {
  productId: string;
  level: StockLevel;
  /** 필요량을 못 채우는 첫 끼니의 날짜. 예측하지 않거나 범위 안에 없으면 null */
  depletionDate: DateString | null;
  /** 오늘부터 소진일까지 일수(오늘이면 0) */
  daysLeft: number | null;
  /** 예정 소비가 있는데 계산 범위를 넘겨도 남는다 ('60일 넘게 충분') */
  beyondHorizon: boolean;
  /** 날짜별 예정 소비(0 인 날은 없음) */
  planned: PlannedConsumption[];
}

interface Need {
  date: DateString;
  quantity: Decimal;
}

/** 한 끼니의 제품별 필요량(stock_unit). 변환할 수 없는 품목은 세지 않는다 */
function slotNeeds(
  items: readonly ForecastItem[],
  products: ReadonlyMap<string, ForecastProduct>,
): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const item of items) {
    const p = products.get(item.productId);
    if (!p || !p.isStockTracked) continue;
    const q = toStockUnit(item.quantity, item.unit, p);
    if (!q || q.lte(0)) continue;
    out.set(p.id, (out.get(p.id) ?? new Decimal(0)).add(q));
  }
  return out;
}

export function forecastStock(input: ForecastInput): Map<string, ProductForecast> {
  const horizon = input.horizonDays ?? FORECAST_HORIZON_DAYS;
  const products = new Map(input.products.map((p) => [p.id, p]));
  const active = new Set<MealSlot>(input.activeSlots);
  const needs = new Map<string, Need[]>();

  for (const date of eachDate(input.today, addDays(input.today, horizon - 1))) {
    for (const slot of MEAL_SLOTS) {
      if (!active.has(slot)) continue;
      if (date === input.today && input.recordedToday.has(slot)) continue;
      const plan = input.resolver.resolve(date, slot);
      if (plan.planType !== 'template' || !plan.templateId) continue;
      const items = input.templateItems.get(plan.templateId);
      if (!items) continue;
      for (const [productId, quantity] of slotNeeds(items, products)) {
        const list = needs.get(productId) ?? [];
        list.push({ date, quantity });
        needs.set(productId, list);
      }
    }
  }

  const out = new Map<string, ProductForecast>();
  for (const p of input.products) {
    const list = needs.get(p.id) ?? [];
    const planned: PlannedConsumption[] = [];
    for (const n of list) {
      const last = planned[planned.length - 1];
      if (last && last.date === n.date) last.quantity = last.quantity.add(n.quantity);
      else planned.push({ date: n.date, quantity: n.quantity });
    }

    const base = { productId: p.id, depletionDate: null, daysLeft: null, beyondHorizon: false };
    if (!p.isStockTracked) {
      out.set(p.id, { ...base, level: 'untracked', planned: [] });
      continue;
    }
    if (p.currentStock.lt(0)) {
      out.set(p.id, { ...base, level: 'check_needed', planned });
      continue;
    }
    if (p.currentStock.isZero()) {
      out.set(p.id, { ...base, level: 'depleted', planned });
      continue;
    }
    if (list.length === 0) {
      out.set(p.id, { ...base, level: 'unpredictable', planned });
      continue;
    }

    let remaining = p.currentStock;
    let depletionDate: DateString | null = null;
    for (const n of list) {
      if (remaining.lt(n.quantity)) {
        depletionDate = n.date;
        break;
      }
      remaining = remaining.minus(n.quantity);
    }
    const daysLeft = depletionDate ? daysBetween(input.today, depletionDate) : null;
    out.set(p.id, {
      productId: p.id,
      level: daysLeft !== null && daysLeft <= input.daysBefore ? 'imminent' : 'ok',
      depletionDate,
      daysLeft,
      beyondHorizon: depletionDate === null,
      planned,
    });
  }
  return out;
}

export interface LowConfidenceInput extends PlanContext {
  /** 살펴볼 첫 날짜(포함). 어제까지 본다 */
  from: DateString;
  /** 먹었음·안 먹음으로 기록된 정규 끼니. 키는 `${date}:${slot}` */
  recorded: ReadonlySet<string>;
  /**
   * 제품별 기준일: 마지막 실측 보정일, 없으면 첫 원장 이동일(사용자 시간대 날짜).
   * 기준일 **뒤** 날짜의 미기록만 센다. 키가 없는 제품(이동 없음)은 판정하지 않는다.
   */
  baseline: ReadonlyMap<string, DateString>;
  /**
   * 식단표 칸이 마지막으로 바뀐 날(사용자 시간대). 키는 `${weekday}:${slot}`.
   * 그 날과 그 앞 날짜는 당시 계획을 알 수 없으므로(D-01: 계획은 저장하지 않는다) 세지 않는다.
   */
  weeklyChangedOn: ReadonlyMap<string, DateString>;
}

/**
 * '추정 신뢰도 낮음' 제품 (FR-08, DEC-080 4). 기준일 뒤 과거 날짜에 그 제품이 든 식단 끼니가
 * 한 번이라도 미기록이면 해당한다. 자유 끼니·오늘·쓰지 않는 끼니, 그리고 식단표 칸이
 * 바뀌기 전 날짜는 세지 않는다.
 */
export function lowConfidenceProducts(input: LowConfidenceInput): Set<string> {
  const out = new Set<string>();
  const active = new Set<MealSlot>(input.activeSlots);
  for (const date of eachDate(input.from, addDays(input.today, -1))) {
    for (const slot of MEAL_SLOTS) {
      if (!active.has(slot) || input.recorded.has(`${date}:${slot}`)) continue;
      const plan = input.resolver.resolve(date, slot);
      if (plan.planType !== 'template' || !plan.templateId) continue;
      if (plan.source === 'weekly') {
        const changed = input.weeklyChangedOn.get(`${isoWeekday(date)}:${slot}`);
        if (changed !== undefined && date <= changed) continue;
      }
      for (const item of input.templateItems.get(plan.templateId) ?? []) {
        const since = input.baseline.get(item.productId);
        if (since !== undefined && date > since) out.add(item.productId);
      }
    }
  }
  return out;
}
