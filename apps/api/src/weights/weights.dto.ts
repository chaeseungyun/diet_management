import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsPositive } from 'class-validator';
import type { WeightRecord } from '@prisma/client';
import { fromDbDate } from '../domain/dates';
import { numReq } from '../common/decimal';

export class PutWeightDto {
  @ApiProperty({ example: 74.3 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  weightKg!: number;

  /** 같은 날 기록이 있을 때 덮어쓰기 확인. 없이 보내면 409 */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class WeightDto {
  @ApiProperty({ example: '2026-11-06' })
  date!: string;

  @ApiProperty()
  weightKg!: number;

  @ApiProperty({ format: 'date-time' })
  measuredAt!: string;

  static from(w: WeightRecord): WeightDto {
    const dto = new WeightDto();
    dto.date = fromDbDate(w.onDate);
    dto.weightKg = numReq(w.weightKg);
    dto.measuredAt = w.measuredAt.toISOString();
    return dto;
  }
}

export class WeightSummaryDto {
  @ApiProperty({ type: WeightDto, nullable: true })
  latest!: WeightDto | null;

  /** 최근 7일(오늘 포함) 실측 평균. 측정이 없으면 null (0 으로 채우지 않음) */
  @ApiProperty({ type: Number, nullable: true })
  last7Avg!: number | null;

  /** 평균에 쓴 측정 횟수 */
  @ApiProperty()
  last7Count!: number;

  @ApiProperty({ type: Number, nullable: true })
  targetWeightKg!: number | null;

  /** 최신 측정값 − 목표. 둘 중 하나라도 없으면 null */
  @ApiProperty({ type: Number, nullable: true })
  diffToTarget!: number | null;

  /** 최신 측정값 − (최신 측정일 7일 이전 또는 그 전 가장 가까운 측정값) */
  @ApiProperty({ type: Number, nullable: true })
  weekChange!: number | null;

  /** 30일 기준, 위와 같은 규칙 */
  @ApiProperty({ type: Number, nullable: true })
  monthChange!: number | null;
}

export class WeightListDto {
  @ApiProperty({ example: '2026-08-08' })
  from!: string;

  @ApiProperty({ example: '2026-11-06' })
  to!: string;

  @ApiProperty({ type: WeightDto, isArray: true })
  items!: WeightDto[];

  @ApiProperty({ type: WeightSummaryDto })
  summary!: WeightSummaryDto;
}
