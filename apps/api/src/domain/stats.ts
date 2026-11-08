/**
 * 통계 계산 (FR-06, FR-07, D-18, D-20, DEC-028, DEC-068). DB 를 모르는 순수 함수.
 * - 평균은 '하루 완료' 이면서 그 지표가 완전한 날만 넣는다. 유효일 0 이면 null('데이터 없음').
 * - 확인된 안 먹음은 0, 미기록은 미상. 미기록을 0 으로 채우지 않는다.
 * - 미래·가입 전 날짜는 추적 대상이 아니다(분모에서도 뺀다).
 */
import { addDays } from './dates';
import { Decimal } from './units';
import type { NutritionValues } from './nutrition';

export const METRICS = ['kcal', 'carbG', 'proteinG', 'fatG'] as const;
export type Metric = (typeof METRICS)[number];

/** 하루의 기록된 합계와 지표별 완전 여부. 미상 값은 더하지 않고 complete=false 로 남긴다 */
export interface DayNutrition {
  values: Record<Metric, Decimal>;
  complete: Record<Metric, boolean>;
}

export function dayNutrition(parts: readonly NutritionValues[]): DayNutrition {
  const values = {} as Record<Metric, Decimal>;
  const complete = {} as Record<Metric, boolean>;
  for (const m of METRICS) {
    values[m] = new Decimal(0);
    complete[m] = true;
  }
  for (const p of parts) {
    for (const m of METRICS) {
      const v = p[m];
      if (v === null) complete[m] = false;
      else values[m] = values[m].add(v);
    }
  }
  return { values, complete };
}

export interface StatsDay {
  date: string;
  /** 가입일 이후이고 오늘 이전(포함) */
  tracked: boolean;
  completed: boolean;
  nutrition: DayNutrition;
  /** 그 날 적용되던 목표 kcal (GoalHistory) */
  goalKcal: number | null;
  weightKg: number | null;
}

export interface MetricAverage {
  /** 유효일 평균. 유효일 0 이면 null */
  average: number | null;
  /** 완료 + 이 지표 완전 */
  validDays: number;
  /** 완료했지만 이 지표가 미상인 날 */
  unknownDays: number;
}

export interface StatsSummary {
  trackedDays: number;
  completedDays: number;
  /** completedDays / trackedDays. 추적일 0 이면 null */
  completionRate: number | null;
  /** 추적일 중 완료하지 않은 날 (평균 제외 이유: 미기록·미완료) */
  notCompletedDays: number;
  averages: Record<Metric, MetricAverage>;
  /** 목표 달성일 (D-20): 완료 + kcal 완전 + 목표가 있던 날 중 kcal ≤ 목표 */
  goal: { achievedDays: number; eligibleDays: number };
  weight: {
    first: { date: string; weightKg: number } | null;
    last: { date: string; weightKg: number } | null;
    /** last - first. 측정 2회 미만이면 null */
    change: number | null;
    measuredDays: number;
  };
}

export function summarize(days: readonly StatsDay[]): StatsSummary {
  const tracked = days.filter((d) => d.tracked);
  const completed = tracked.filter((d) => d.completed);
  const averages = {} as Record<Metric, MetricAverage>;
  for (const m of METRICS) {
    const valid = completed.filter((d) => d.nutrition.complete[m]);
    const sum = valid.reduce((s, d) => s.add(d.nutrition.values[m]), new Decimal(0));
    averages[m] = {
      average: valid.length === 0 ? null : round1(sum.div(valid.length).toNumber()),
      validDays: valid.length,
      unknownDays: completed.length - valid.length,
    };
  }
  let achievedDays = 0;
  let eligibleDays = 0;
  for (const d of completed) {
    if (d.goalKcal === null || !d.nutrition.complete.kcal) continue;
    eligibleDays += 1;
    if (d.nutrition.values.kcal.lte(d.goalKcal)) achievedDays += 1;
  }
  const weighed = tracked.filter((d) => d.weightKg !== null);
  const first = weighed[0];
  const last = weighed.at(-1);
  return {
    trackedDays: tracked.length,
    completedDays: completed.length,
    completionRate: tracked.length === 0 ? null : completed.length / tracked.length,
    notCompletedDays: tracked.length - completed.length,
    averages,
    goal: { achievedDays, eligibleDays },
    weight: {
      first: first ? { date: first.date, weightKg: first.weightKg! } : null,
      last: last ? { date: last.date, weightKg: last.weightKg! } : null,
      change:
        first && last && weighed.length >= 2 ? round2(last.weightKg! - first.weightKg!) : null,
      measuredDays: weighed.length,
    },
  };
}

/**
 * 현재 연속 기록 일수 (FR-06: 체중·식단 준수가 아니라 하루 완료 기반).
 * 오늘을 아직 완료하지 않았으면 어제부터 센다(오늘이 끝나기 전에 끊지 않는다).
 */
export function currentStreak(
  completed: ReadonlySet<string>,
  today: string,
  signup: string,
): number {
  let cur = completed.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (cur >= signup && completed.has(cur)) {
    n += 1;
    cur = addDays(cur, -1);
  }
  return n;
}

/** 계획 실천 판정에 필요한 스냅샷 필드 */
export interface PlannedItem {
  plannedQuantity: Decimal | null;
  actualQuantity: Decimal | null;
}

/**
 * 식단 끼니를 '계획대로' 먹었는가 (FR-06 계획 실천율, 1차는 정확 일치, DEC-028 미정 → DEC-068).
 * 먹었음 + 내 식품 + 품목이 있고, 모든 품목이 식단에 있던 것이며 실제량 = 계획량.
 * 한계: 기록 시점의 식단 품목 수를 저장하지 않아 '식단 품목 하나를 빼고 먹은 경우' 는 구분하지 못한다.
 */
export function isAsPlanned(status: string, kind: string, items: readonly PlannedItem[]): boolean {
  if (status !== 'eaten' || kind !== 'home' || items.length === 0) return false;
  return items.every(
    (i) =>
      i.plannedQuantity !== null &&
      i.actualQuantity !== null &&
      i.actualQuantity.eq(i.plannedQuantity),
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
