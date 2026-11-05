import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';
import type { GoalHistory } from '@prisma/client';
import { IsCalendarDate } from '../common/validators';
import { fromDbDate } from '../domain/dates';
import { num, numReq } from '../common/decimal';

export class CreateGoalDto {
  /** 적용 시작일(YYYY-MM-DD). 생략하면 오늘(사용자 시간대). 같은 날짜가 있으면 덮어쓴다 */
  @ApiPropertyOptional({ example: '2026-11-06' })
  @IsOptional()
  @IsCalendarDate()
  effectiveFrom?: string;

  @ApiProperty({ example: 72.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetWeightKg!: number;

  @ApiProperty({ example: 1800 })
  @IsInt()
  @IsPositive()
  dailyKcal!: number;

  @ApiProperty({ example: 140 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  proteinG!: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  carbG?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fatG?: number | null;
}

export class GoalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-11-06' })
  effectiveFrom!: string;

  @ApiProperty()
  targetWeightKg!: number;

  @ApiProperty()
  dailyKcal!: number;

  @ApiProperty()
  proteinG!: number;

  @ApiProperty({ type: Number, nullable: true })
  carbG!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fatG!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** 오늘(사용자 시간대) 적용 중인 목표인가 */
  @ApiProperty()
  current!: boolean;

  static from(g: GoalHistory, current = false): GoalDto {
    const dto = new GoalDto();
    dto.id = g.id;
    dto.effectiveFrom = fromDbDate(g.effectiveFrom);
    dto.targetWeightKg = numReq(g.targetWeightKg);
    dto.dailyKcal = g.dailyKcal;
    dto.proteinG = numReq(g.proteinG);
    dto.carbG = num(g.carbG);
    dto.fatG = num(g.fatG);
    dto.createdAt = g.createdAt.toISOString();
    dto.current = current;
    return dto;
  }
}

export class EffectiveGoalDto {
  @ApiProperty({ example: '2026-11-06' })
  date!: string;

  /** 그 날짜에 적용되는 목표. 없으면 null */
  @ApiProperty({ type: GoalDto, nullable: true })
  goal!: GoalDto | null;
}
