/**
 * 계획 해석 (D-01). 날짜·슬롯의 계획 = DateOverride 가 있으면 그것, 없으면 WeeklySchedule[weekday], 둘 다 없으면 '계획 없음'.
 * 오늘 조회·소진 예측·완료 판정·알림 예약이 모두 이 함수를 쓴다. 저장하지 않는다.
 */
import type { MealSlot, PlanType } from '@prisma/client';
import { isoWeekday, type DateString } from './dates';

export interface PlanCell {
  planType: PlanType;
  templateId: string | null;
}

export interface WeeklyCell extends PlanCell {
  weekday: number;
  slot: MealSlot;
}

export interface OverrideCell extends PlanCell {
  id: string;
  onDate: DateString;
  slot: MealSlot;
  batchId: string | null;
  note: string | null;
}

export interface ResolvedPlan extends PlanCell {
  /** override = 날짜 예외, weekly = 반복 계획, default = 둘 다 없음(계획 없음) */
  source: 'override' | 'weekly' | 'default';
  overrideId: string | null;
  note: string | null;
}

export const NO_PLAN: ResolvedPlan = {
  planType: 'none',
  templateId: null,
  source: 'default',
  overrideId: null,
  note: null,
};

export class PlanResolver {
  private readonly weekly = new Map<string, WeeklyCell>();
  private readonly overrides = new Map<string, OverrideCell>();

  constructor(weekly: readonly WeeklyCell[], overrides: readonly OverrideCell[]) {
    for (const w of weekly) this.weekly.set(`${w.weekday}:${w.slot}`, w);
    for (const o of overrides) this.overrides.set(`${o.onDate}:${o.slot}`, o);
  }

  resolve(date: DateString, slot: MealSlot): ResolvedPlan {
    const o = this.overrides.get(`${date}:${slot}`);
    if (o) {
      return {
        planType: o.planType,
        templateId: o.planType === 'template' ? o.templateId : null,
        source: 'override',
        overrideId: o.id,
        note: o.note,
      };
    }
    const w = this.weekly.get(`${isoWeekday(date)}:${slot}`);
    if (w) {
      return {
        planType: w.planType,
        templateId: w.planType === 'template' ? w.templateId : null,
        source: 'weekly',
        overrideId: null,
        note: null,
      };
    }
    return NO_PLAN;
  }
}
