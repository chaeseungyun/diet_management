import { Injectable } from '@nestjs/common';
import type { GoalHistory, Prisma, User } from '@prisma/client';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toDbDate } from '../domain/dates';
import { dec } from '../common/decimal';
import { CreateGoalDto, EffectiveGoalDto, GoalDto } from './goals.dto';

type Db = Prisma.TransactionClient | PrismaService;

/** 목표 이력 (FR-01). 특정 날짜의 목표 = effective_from <= 날짜 중 가장 늦은 행 */
@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 다른 서비스(오늘 화면·체중 요약)도 같은 규칙을 쓴다 */
  async effectiveGoal(db: Db, userId: string, date: string): Promise<GoalHistory | null> {
    return db.goalHistory.findFirst({
      where: { userId, effectiveFrom: { lte: toDbDate(date) } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async list(user: User): Promise<GoalDto[]> {
    const today = todayIn(user.timezone);
    const [rows, current] = await Promise.all([
      this.prisma.goalHistory.findMany({
        where: { userId: user.id },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.effectiveGoal(this.prisma, user.id, today),
    ]);
    return rows.map((g) => GoalDto.from(g, g.id === current?.id));
  }

  async create(user: User, dto: CreateGoalDto): Promise<GoalDto> {
    const today = todayIn(user.timezone);
    const effectiveFrom = toDbDate(dto.effectiveFrom ?? today);
    const data = {
      targetWeightKg: dec(dto.targetWeightKg),
      dailyKcal: dto.dailyKcal,
      proteinG: dec(dto.proteinG),
      carbG: dec(dto.carbG ?? null),
      fatG: dec(dto.fatG ?? null),
    };
    const saved = await this.prisma.goalHistory.upsert({
      where: { userId_effectiveFrom: { userId: user.id, effectiveFrom } },
      create: { userId: user.id, effectiveFrom, ...data },
      update: data,
    });
    const current = await this.effectiveGoal(this.prisma, user.id, today);
    return GoalDto.from(saved, saved.id === current?.id);
  }

  async effective(user: User, date: string | undefined): Promise<EffectiveGoalDto> {
    const d = date ?? todayIn(user.timezone);
    const goal = await this.effectiveGoal(this.prisma, user.id, d);
    return { date: d, goal: goal ? GoalDto.from(goal, true) : null };
  }
}
