import { Injectable } from '@nestjs/common';
import type { GoalHistory, User } from '@prisma/client';
import { MEAL_SLOTS, todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertRange } from '../common/validators';
import { eachDate, fromDbDate, toDbDate } from '../domain/dates';
import type { NutritionValues } from '../domain/nutrition';
import {
  currentStreak,
  dayNutrition,
  isAsPlanned,
  summarize,
  type StatsDay,
} from '../domain/stats';
import type { AdherenceDto, StatsDailyDto, StatsSummaryDto } from './stats.dto';

/** 한 번에 볼 수 있는 기간 (1년 + 윤일) */
export const STATS_MAX_RANGE_DAYS = 366;

const REGULAR_SLOTS = new Set<string>(MEAL_SLOTS);

/**
 * 통계 (FR-06, FR-07, S-60, api.md §10). 저장하지 않고 조회 시 계산한다(screens §9-6).
 * 날짜별 합계는 스냅샷에서 다시 더하므로 D-03 보완 뒤에는 자동으로 '영양 완전' 이 된다.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: User, from: string, to: string): Promise<StatsSummaryDto> {
    assertRange(from, to, STATS_MAX_RANGE_DAYS);
    const today = todayIn(user.timezone);
    const signup = todayIn(user.timezone, user.createdAt);
    const [{ days, records }, allCompletions, freeOverrides] = await Promise.all([
      this.loadDays(user, from, to),
      this.prisma.dayCompletion.findMany({
        where: { userId: user.id, onDate: { lte: toDbDate(today) } },
        select: { onDate: true },
      }),
      this.prisma.dateOverride.count({
        where: {
          userId: user.id,
          planType: 'none',
          onDate: { gte: toDbDate(max(from, signup)), lte: toDbDate(min(to, today)) },
        },
      }),
    ]);
    const s = summarize(days);
    const tracked = new Set(days.filter((d) => d.tracked).map((d) => d.date));

    const adherence: AdherenceDto = {
      plannedSlots: 0,
      asPlannedSlots: 0,
      modifiedSlots: 0,
      skippedSlots: 0,
      rate: null,
      overriddenSlots: 0,
      excludedByOverride: freeOverrides,
    };
    for (const r of records) {
      // 분모: 기록 당시 식단이 적용된 정규 끼니(templateId 는 기록 생성 시 계획에서 온다).
      // 자유 끼니로 사전 변경한 끼니는 templateId 가 없어 자연히 빠진다.
      if (!REGULAR_SLOTS.has(r.slot) || r.templateId === null) continue;
      if (!tracked.has(fromDbDate(r.mealDate))) continue;
      adherence.plannedSlots += 1;
      if (r.planChanged) adherence.overriddenSlots += 1;
      if (r.status === 'skipped') adherence.skippedSlots += 1;
      else if (isAsPlanned(r.status, r.kind, r.items)) adherence.asPlannedSlots += 1;
      else adherence.modifiedSlots += 1;
    }
    adherence.rate =
      adherence.plannedSlots === 0 ? null : adherence.asPlannedSlots / adherence.plannedSlots;

    return {
      from,
      to,
      trackedDays: s.trackedDays,
      completedDays: s.completedDays,
      completionRate: s.completionRate,
      notCompletedDays: s.notCompletedDays,
      currentStreak: currentStreak(
        new Set(allCompletions.map((c) => fromDbDate(c.onDate))),
        today,
        signup,
      ),
      averages: s.averages,
      goal: s.goal,
      weight: s.weight,
      adherence,
    };
  }

  async daily(user: User, from: string, to: string): Promise<StatsDailyDto> {
    assertRange(from, to, STATS_MAX_RANGE_DAYS);
    const { days } = await this.loadDays(user, from, to);
    return {
      from,
      to,
      days: days.map((d) => ({
        date: d.date,
        tracked: d.tracked,
        completed: d.completed,
        kcal: d.nutrition.values.kcal.toNumber(),
        carbG: d.nutrition.values.carbG.toNumber(),
        proteinG: d.nutrition.values.proteinG.toNumber(),
        fatG: d.nutrition.values.fatG.toNumber(),
        complete: { ...d.nutrition.complete },
        goalKcal: d.goalKcal,
        weightKg: d.weightKg,
      })),
    };
  }

  /** 기간의 날짜별 입력을 한 번에 모은다 (기록·완료·목표·체중 4개 쿼리) */
  private async loadDays(user: User, from: string, to: string) {
    const today = todayIn(user.timezone);
    const signup = todayIn(user.timezone, user.createdAt);
    const range = { gte: toDbDate(from), lte: toDbDate(to) };
    const [records, completions, goals, weights] = await Promise.all([
      this.prisma.mealRecord.findMany({
        where: { userId: user.id, mealDate: range, status: { in: ['eaten', 'skipped'] } },
        select: {
          mealDate: true,
          slot: true,
          status: true,
          kind: true,
          templateId: true,
          planChanged: true,
          outsideKcal: true,
          outsideCarbG: true,
          outsideProteinG: true,
          outsideFatG: true,
          items: {
            select: {
              kcal: true,
              carbG: true,
              proteinG: true,
              fatG: true,
              plannedQuantity: true,
              actualQuantity: true,
            },
          },
        },
      }),
      this.prisma.dayCompletion.findMany({
        where: { userId: user.id, onDate: range },
        select: { onDate: true },
      }),
      this.prisma.goalHistory.findMany({
        where: { userId: user.id, effectiveFrom: { lte: toDbDate(to) } },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.weightRecord.findMany({
        where: { userId: user.id, onDate: range },
        select: { onDate: true, weightKg: true },
      }),
    ]);

    // 먹었음만 영양에 들어간다. 안 먹음은 확인된 0 이므로 부분이 없다 (FR-06)
    const parts = new Map<string, NutritionValues[]>();
    for (const r of records) {
      if (r.status !== 'eaten') continue;
      const date = fromDbDate(r.mealDate);
      const list = parts.get(date) ?? [];
      for (const i of r.items) list.push(i);
      if (r.kind === 'outside') {
        list.push({
          kcal: r.outsideKcal,
          carbG: r.outsideCarbG,
          proteinG: r.outsideProteinG,
          fatG: r.outsideFatG,
        });
      }
      parts.set(date, list);
    }
    const completed = new Set(completions.map((c) => fromDbDate(c.onDate)));
    const weightBy = new Map(weights.map((w) => [fromDbDate(w.onDate), w.weightKg.toNumber()]));

    const days: StatsDay[] = eachDate(from, to, STATS_MAX_RANGE_DAYS + 1).map((date) => {
      const tracked = date >= signup && date <= today;
      return {
        date,
        tracked,
        completed: tracked && completed.has(date),
        nutrition: dayNutrition(parts.get(date) ?? []),
        goalKcal: goalOn(goals, date)?.dailyKcal ?? null,
        weightKg: weightBy.get(date) ?? null,
      };
    });
    return { days, records };
  }
}

/** goals 는 effectiveFrom 오름차순 */
function goalOn(goals: readonly GoalHistory[], date: string): GoalHistory | null {
  let found: GoalHistory | null = null;
  for (const g of goals) {
    if (fromDbDate(g.effectiveFrom) <= date) found = g;
    else break;
  }
  return found;
}

function max(a: string, b: string): string {
  return a > b ? a : b;
}

function min(a: string, b: string): string {
  return a < b ? a : b;
}
