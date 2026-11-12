import { Injectable, NotFoundException } from '@nestjs/common';
import { conflict, unprocessable } from '../common/errors';
import type { User, WeightRecord } from '@prisma/client';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, fromDbDate, toDbDate } from '../domain/dates';
import { assertRange } from '../common/validators';
import { dec, num } from '../common/decimal';
import { GoalsService } from '../goals/goals.service';
import { PutWeightDto, WeightDto, WeightListDto, WeightSummaryDto } from './weights.dto';

const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 400;

/** 체중 (FR-07, S-50). 미측정일은 행 없음. 0 으로 채우지 않는다 */
@Injectable()
export class WeightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
  ) {}

  async list(user: User, from?: string, to?: string): Promise<WeightListDto> {
    const today = todayIn(user.timezone);
    const end = to ?? today;
    const start = from ?? addDays(end, -(DEFAULT_RANGE_DAYS - 1));
    assertRange(start, end, MAX_RANGE_DAYS);

    const [items, summary] = await Promise.all([
      this.prisma.weightRecord.findMany({
        where: { userId: user.id, onDate: { gte: toDbDate(start), lte: toDbDate(end) } },
        orderBy: { onDate: 'desc' },
      }),
      this.summary(user, today),
    ]);
    return { from: start, to: end, items: items.map(WeightDto.from), summary };
  }

  /** 오늘 화면(S-10)도 그 날짜의 체중만 쓴다 */
  async forDate(userId: string, date: string): Promise<WeightRecord | null> {
    return this.prisma.weightRecord.findUnique({
      where: { userId_onDate: { userId, onDate: toDbDate(date) } },
    });
  }

  private async summary(user: User, today: string): Promise<WeightSummaryDto> {
    // 요약은 조회 범위와 무관하게 오늘 기준. 최근 1년만 본다
    const since = addDays(today, -365);
    const [rows, goal] = await Promise.all([
      this.prisma.weightRecord.findMany({
        where: { userId: user.id, onDate: { gte: toDbDate(since), lte: toDbDate(today) } },
        orderBy: { onDate: 'desc' },
      }),
      this.goals.effectiveGoal(this.prisma, user.id, today),
    ]);
    const latest = rows[0] ?? null;
    const last7From = addDays(today, -6);
    const last7 = rows.filter((r) => fromDbDate(r.onDate) >= last7From);
    const last7Avg =
      last7.length === 0
        ? null
        : last7.reduce((s, r) => s + r.weightKg.toNumber(), 0) / last7.length;

    const baseline = (daysBack: number): WeightRecord | null => {
      if (!latest) return null;
      const cutoff = addDays(fromDbDate(latest.onDate), -daysBack);
      return rows.find((r) => fromDbDate(r.onDate) <= cutoff) ?? null;
    };
    const change = (b: WeightRecord | null): number | null =>
      latest && b ? latest.weightKg.sub(b.weightKg).toNumber() : null;

    const target = goal ? num(goal.targetWeightKg) : null;
    return {
      latest: latest ? WeightDto.from(latest) : null,
      last7Avg,
      last7Count: last7.length,
      targetWeightKg: target,
      diffToTarget: latest && target !== null ? latest.weightKg.toNumber() - target : null,
      weekChange: change(baseline(7)),
      monthChange: change(baseline(30)),
    };
  }

  async put(user: User, date: string, dto: PutWeightDto): Promise<WeightDto> {
    const today = todayIn(user.timezone);
    if (date > today) throw unprocessable('FUTURE_DATE', 'future date');
    const onDate = toDbDate(date);
    const existing = await this.forDate(user.id, date);
    if (existing && !dto.overwrite) {
      throw conflict('WEIGHT_EXISTS', 'weight already recorded for this date; send overwrite=true');
    }
    const saved = await this.prisma.weightRecord.upsert({
      where: { userId_onDate: { userId: user.id, onDate } },
      create: { userId: user.id, onDate, weightKg: dec(dto.weightKg) },
      update: { weightKg: dec(dto.weightKg), measuredAt: new Date() },
    });
    return WeightDto.from(saved);
  }

  async remove(user: User, date: string): Promise<void> {
    const deleted = await this.prisma.weightRecord.deleteMany({
      where: { userId: user.id, onDate: toDbDate(date) },
    });
    if (deleted.count === 0) throw new NotFoundException();
  }
}
