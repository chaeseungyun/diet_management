import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { DateOverride, WeeklySchedule } from '@prisma/client';
import {
  MEAL_SLOTS,
  NOTE_MAX_LENGTH,
  PLAN_TYPES,
  type MealSlot,
  type PlanType,
} from '@diet/shared';
import { IsCalendarDate } from '../common/validators';
import { fromDbDate } from '../domain/dates';
import type { ResolvedPlan } from '../domain/plan';

export class PutPlanCellDto {
  @ApiProperty({ enum: PLAN_TYPES })
  @IsIn(PLAN_TYPES)
  planType!: PlanType;

  /** planType=template 이면 필수 */
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  templateId?: string | null;
}

export class WeeklyGridCellInputDto extends PutPlanCellDto {
  /** ISO 1=월 … 7=일 */
  @ApiProperty({ minimum: 1, maximum: 7 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ enum: MEAL_SLOTS })
  @IsIn(MEAL_SLOTS)
  slot!: MealSlot;
}

export class PutWeeklyGridDto {
  /** 격자 전체. 빠진 셀은 '계획 없음' */
  @ApiProperty({ type: WeeklyGridCellInputDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(35)
  @ValidateNested({ each: true })
  @Type(() => WeeklyGridCellInputDto)
  cells!: WeeklyGridCellInputDto[];
}

export class WeeklyCellDto {
  @ApiProperty()
  weekday!: number;

  @ApiProperty({ enum: MEAL_SLOTS })
  slot!: MealSlot;

  @ApiProperty({ enum: PLAN_TYPES })
  planType!: PlanType;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  templateId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  templateName!: string | null;

  static from(w: WeeklySchedule, templateName: string | null): WeeklyCellDto {
    return {
      weekday: w.weekday,
      slot: w.slot as MealSlot,
      planType: w.planType,
      templateId: w.templateId,
      templateName,
    };
  }
}

export class WeeklyGridDto {
  /** 7×5 = 35 셀, 요일·슬롯 순 */
  @ApiProperty({ type: WeeklyCellDto, isArray: true })
  cells!: WeeklyCellDto[];
}

export class PutOverrideDto extends PutPlanCellDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string | null;
}

export class BatchOverrideDto extends PutOverrideDto {
  @ApiProperty({ example: '2026-11-10' })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({ example: '2026-11-12' })
  @IsCalendarDate()
  to!: string;

  /** 바꿀 슬롯. 유지할 슬롯은 빼면 된다 */
  @ApiProperty({ enum: MEAL_SLOTS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn(MEAL_SLOTS, { each: true })
  slots!: MealSlot[];
}

export class BatchResultDto {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty()
  count!: number;
}

export class OverrideDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-11-10' })
  date!: string;

  @ApiProperty({ enum: MEAL_SLOTS })
  slot!: MealSlot;

  @ApiProperty({ enum: PLAN_TYPES })
  planType!: PlanType;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  templateId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  templateName!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  batchId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(o: DateOverride, templateName: string | null): OverrideDto {
    return {
      id: o.id,
      date: fromDbDate(o.onDate),
      slot: o.slot as MealSlot,
      planType: o.planType,
      templateId: o.templateId,
      templateName,
      batchId: o.batchId,
      note: o.note,
      createdAt: o.createdAt.toISOString(),
    };
  }
}

export class ResolvedSlotDto {
  @ApiProperty({ example: '2026-11-10' })
  date!: string;

  @ApiProperty({ enum: MEAL_SLOTS })
  slot!: MealSlot;

  @ApiProperty({ enum: PLAN_TYPES })
  planType!: PlanType;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  templateId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  templateName!: string | null;

  /** override = 날짜 예외, weekly = 반복 계획, default = 둘 다 없음 */
  @ApiProperty({ enum: ['override', 'weekly', 'default'] })
  source!: 'override' | 'weekly' | 'default';

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  overrideId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  static from(
    date: string,
    slot: MealSlot,
    plan: ResolvedPlan,
    templateName: string | null,
  ): ResolvedSlotDto {
    return {
      date,
      slot,
      planType: plan.planType,
      templateId: plan.templateId,
      templateName,
      source: plan.source,
      overrideId: plan.overrideId,
      note: plan.note,
    };
  }
}
