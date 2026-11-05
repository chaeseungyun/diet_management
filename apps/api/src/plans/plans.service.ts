import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { MEAL_SLOTS, WEEKDAYS, type MealSlot } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { assertRange } from '../common/validators';
import { eachDate, fromDbDate, toDbDate } from '../domain/dates';
import { PlanResolver, type OverrideCell, type WeeklyCell } from '../domain/plan';
import {
  BatchOverrideDto,
  BatchResultDto,
  OverrideDto,
  PutOverrideDto,
  PutPlanCellDto,
  PutWeeklyGridDto,
  ResolvedSlotDto,
  WeeklyCellDto,
  WeeklyGridDto,
} from './plans.dto';

type Db = Prisma.TransactionClient | PrismaService;

export const MAX_PLAN_RANGE_DAYS = 62;

/** 주간 반복·날짜 예외 (FR-04, D-01, S-22~S-24). 계획은 저장하지 않고 조회 시 해석한다 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 해석 (다른 모듈 공용) ----------

  /** 기간의 반복 계획·예외를 한 번에 읽어 해석기를 만든다 */
  async loadResolver(db: Db, userId: string, from: string, to: string): Promise<PlanResolver> {
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

  private async templateNames(db: Db, userId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await db.mealTemplate.findMany({
      where: { userId, id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** 셀 입력 정규화: template 이면 소유·활성 템플릿 필수, 아니면 templateId 무시 */
  private async normalizeCell(
    db: Db,
    userId: string,
    cell: PutPlanCellDto,
  ): Promise<{ planType: PutPlanCellDto['planType']; templateId: string | null }> {
    if (cell.planType !== 'template') return { planType: cell.planType, templateId: null };
    if (!cell.templateId) {
      throw new UnprocessableEntityException('templateId is required when planType=template');
    }
    const t = await db.mealTemplate.findFirst({ where: { id: cell.templateId, userId } });
    if (!t) throw new NotFoundException();
    if (t.archivedAt) throw new UnprocessableEntityException('template is archived');
    return { planType: 'template', templateId: t.id };
  }

  // ---------- 주간 반복 ----------

  async weekly(userId: string): Promise<WeeklyGridDto> {
    const rows = await this.prisma.weeklySchedule.findMany({ where: { userId } });
    const names = await this.templateNames(
      this.prisma,
      userId,
      rows.map((r) => r.templateId),
    );
    const byKey = new Map(rows.map((r) => [`${r.weekday}:${r.slot}`, r]));
    const cells: WeeklyCellDto[] = [];
    for (const weekday of WEEKDAYS) {
      for (const slot of MEAL_SLOTS) {
        const r = byKey.get(`${weekday}:${slot}`);
        cells.push(
          r
            ? WeeklyCellDto.from(r, r.templateId ? (names.get(r.templateId) ?? null) : null)
            : { weekday, slot, planType: 'none', templateId: null, templateName: null },
        );
      }
    }
    return { cells };
  }

  async putWeeklyCell(
    userId: string,
    weekday: number,
    slot: MealSlot,
    dto: PutPlanCellDto,
  ): Promise<WeeklyCellDto> {
    const cell = await this.normalizeCell(this.prisma, userId, dto);
    const saved = await this.prisma.weeklySchedule.upsert({
      where: { userId_weekday_slot: { userId, weekday, slot } },
      create: { userId, weekday, slot, ...cell },
      update: cell,
    });
    const names = await this.templateNames(this.prisma, userId, [saved.templateId]);
    return WeeklyCellDto.from(
      saved,
      saved.templateId ? (names.get(saved.templateId) ?? null) : null,
    );
  }

  /** 격자 전체 교체(요일 복사용). 빠진 셀은 계획 없음 = 행 삭제 */
  async putWeeklyGrid(userId: string, dto: PutWeeklyGridDto): Promise<WeeklyGridDto> {
    const seen = new Set<string>();
    for (const c of dto.cells) {
      const key = `${c.weekday}:${c.slot}`;
      if (seen.has(key)) throw new UnprocessableEntityException(`duplicate cell ${key}`);
      seen.add(key);
    }
    await this.prisma.$transaction(async (tx) => {
      const cells = [];
      for (const c of dto.cells) {
        cells.push({
          weekday: c.weekday,
          slot: c.slot,
          ...(await this.normalizeCell(tx, userId, c)),
        });
      }
      await tx.weeklySchedule.deleteMany({ where: { userId } });
      const toCreate = cells.filter((c) => c.planType !== 'none');
      if (toCreate.length > 0) {
        await tx.weeklySchedule.createMany({ data: toCreate.map((c) => ({ userId, ...c })) });
      }
    });
    return this.weekly(userId);
  }

  // ---------- 날짜 예외 ----------

  async overrides(userId: string, from: string, to: string): Promise<OverrideDto[]> {
    assertRange(from, to, MAX_PLAN_RANGE_DAYS);
    const rows = await this.prisma.dateOverride.findMany({
      where: { userId, onDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: [{ onDate: 'asc' }, { slot: 'asc' }],
    });
    const names = await this.templateNames(
      this.prisma,
      userId,
      rows.map((r) => r.templateId),
    );
    return rows.map((r) =>
      OverrideDto.from(r, r.templateId ? (names.get(r.templateId) ?? null) : null),
    );
  }

  async putOverride(
    userId: string,
    date: string,
    slot: MealSlot,
    dto: PutOverrideDto,
  ): Promise<OverrideDto> {
    const cell = await this.normalizeCell(this.prisma, userId, dto);
    const onDate = toDbDate(date);
    const saved = await this.prisma.dateOverride.upsert({
      where: { userId_onDate_slot: { userId, onDate, slot } },
      create: { userId, onDate, slot, ...cell, note: dto.note?.trim() || null, batchId: null },
      update: { ...cell, note: dto.note?.trim() || null, batchId: null },
    });
    const names = await this.templateNames(this.prisma, userId, [saved.templateId]);
    return OverrideDto.from(saved, saved.templateId ? (names.get(saved.templateId) ?? null) : null);
  }

  /** 예외 해제 → 반복 계획으로 복귀. 기존 MealRecord 는 건드리지 않는다 (FR-04) */
  async deleteOverride(userId: string, date: string, slot: MealSlot): Promise<void> {
    const r = await this.prisma.dateOverride.deleteMany({
      where: { userId, onDate: toDbDate(date), slot },
    });
    if (r.count === 0) throw new NotFoundException();
  }

  /** 기간·슬롯 일괄 변경(출장). 같은 batch_id 로 묶어 한 번에 해제할 수 있다 */
  async batch(userId: string, dto: BatchOverrideDto): Promise<BatchResultDto> {
    assertRange(dto.from, dto.to, MAX_PLAN_RANGE_DAYS);
    const slots = [...new Set(dto.slots)];
    const batchId = randomUUID();
    const count = await this.prisma.$transaction(async (tx) => {
      const cell = await this.normalizeCell(tx, userId, dto);
      const note = dto.note?.trim() || null;
      let n = 0;
      for (const date of eachDate(dto.from, dto.to)) {
        const onDate = toDbDate(date);
        for (const slot of slots) {
          await tx.dateOverride.upsert({
            where: { userId_onDate_slot: { userId, onDate, slot } },
            create: { userId, onDate, slot, ...cell, note, batchId },
            update: { ...cell, note, batchId },
          });
          n += 1;
        }
      }
      return n;
    });
    return { batchId, count };
  }

  async deleteBatch(userId: string, batchId: string): Promise<void> {
    const r = await this.prisma.dateOverride.deleteMany({ where: { userId, batchId } });
    if (r.count === 0) throw new NotFoundException();
  }

  // ---------- 해석 결과 ----------

  async resolved(userId: string, from: string, to: string): Promise<ResolvedSlotDto[]> {
    assertRange(from, to, MAX_PLAN_RANGE_DAYS);
    const resolver = await this.loadResolver(this.prisma, userId, from, to);
    const out: { date: string; slot: MealSlot; plan: ReturnType<PlanResolver['resolve']> }[] = [];
    for (const date of eachDate(from, to)) {
      for (const slot of MEAL_SLOTS) out.push({ date, slot, plan: resolver.resolve(date, slot) });
    }
    const names = await this.templateNames(
      this.prisma,
      userId,
      out.map((o) => o.plan.templateId),
    );
    return out.map((o) =>
      ResolvedSlotDto.from(
        o.date,
        o.slot,
        o.plan,
        o.plan.templateId ? (names.get(o.plan.templateId) ?? null) : null,
      ),
    );
  }
}
