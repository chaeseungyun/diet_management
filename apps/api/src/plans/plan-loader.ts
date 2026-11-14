import type { Prisma } from '@prisma/client';
import { fromDbDate, toDbDate } from '../domain/dates';
import { PlanResolver, type OverrideCell, type WeeklyCell } from '../domain/plan';

type Db = Pick<Prisma.TransactionClient, 'weeklySchedule' | 'dateOverride'>;

/**
 * 기간의 반복 계획·예외를 한 번에 읽어 해석기를 만든다 (D-01).
 * 서비스가 아니라 함수인 이유: 재고 예측(StockModule)과 계획(PlansModule)이 서로를 쓰기 때문에
 * 모듈 순환 없이 양쪽에서 부를 수 있어야 한다.
 */
export async function loadPlanResolver(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<PlanResolver> {
  const [weekly, overrides] = await Promise.all([
    db.weeklySchedule.findMany({ where: { userId } }),
    db.dateOverride.findMany({
      where: { userId, onDate: { gte: toDbDate(from), lte: toDbDate(to) } },
    }),
  ]);
  const weeklyCells: WeeklyCell[] = weekly.map((w) => ({
    weekday: w.weekday,
    slot: w.slot,
    planType: w.planType,
    templateId: w.templateId,
  }));
  const overrideCells: OverrideCell[] = overrides.map((o) => ({
    id: o.id,
    onDate: fromDbDate(o.onDate),
    slot: o.slot,
    planType: o.planType,
    templateId: o.templateId,
    batchId: o.batchId,
    note: o.note,
  }));
  return new PlanResolver(weeklyCells, overrideCells);
}
