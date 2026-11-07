import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  DayCompletion,
  MealItemSnapshot,
  MealRecord,
  Product,
  ProductNutritionVersion,
} from '@prisma/client';
import {
  EXTRA_SLOT,
  MEAL_KINDS,
  MEAL_SLOTS,
  MEAL_STATUSES,
  NAME_MAX_LENGTH,
  PLAN_TYPES,
  STOCK_UNITS,
  displayUnit,
  type AnySlot,
  type MealKind,
  type MealSlot,
  type MealStatus,
  type PlanType,
  type StockUnit,
} from '@diet/shared';
import { NutritionTotalsDto, NutritionValuesDto } from '../common/nutrition.dto';
import { num } from '../common/decimal';
import type { NutritionTotals, NutritionValues } from '../domain/nutrition';
import { allowedUnits } from '../domain/units';
import type { ResolvedPlan } from '../domain/plan';
import { GoalDto } from '../goals/goals.dto';
import { WeightDto } from '../weights/weights.dto';

export class MealItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  /** 실제량. 재고 비관리 제품은 생략 가능(기본 추정량 사용, 출처 manual_estimate). 재고 관리 제품은 필수 */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number | null;

  @ApiProperty({ enum: STOCK_UNITS })
  @IsIn(STOCK_UNITS)
  unit!: StockUnit;
}

/** 상태 설정 요청 (D-04). 델타가 아니라 최종 상태를 보낸다 */
export class PutMealRecordDto {
  @ApiProperty({ enum: MEAL_STATUSES })
  @IsIn(MEAL_STATUSES)
  status!: MealStatus;

  /** home = 내 식품(등록한 제품으로 구성, 재고 차감), outside = 식단 외 식사(배달·외식·본가 집밥, 메뉴명·영양 직접 입력, D-19). 기본 home */
  @ApiPropertyOptional({ enum: MEAL_KINDS, default: 'home' })
  @IsOptional()
  @IsIn(MEAL_KINDS)
  kind?: MealKind;

  /** status=eaten 일 때 먹은 품목. 외부 식사에서는 '추가한 식단 품목' 만 (이 항목만 차감) */
  @ApiPropertyOptional({ type: MealItemInputDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MealItemInputDto)
  items?: MealItemInputDto[];

  /** kind=outside, status=eaten 이면 필수 */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  outsideMenu?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  outsideKcal?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  outsideCarbG?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  outsideProteinG?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  outsideFatG?: number | null;

  /** 조회로 받은 version. 레코드가 없던 슬롯은 null. 불일치는 409 (D-08) */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((o: PutMealRecordDto) => o.version !== null && o.version !== undefined)
  @IsInt()
  @Min(0)
  version?: number | null;
}

export class MealItemDto {
  /** 저장된 스냅샷 id. 계획에서 계산한 가상 항목은 null */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  id!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  productId!: string | null;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ type: Number, nullable: true })
  plannedQuantity!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  actualQuantity!: number | null;

  @ApiProperty({ enum: STOCK_UNITS })
  unit!: StockUnit;

  @ApiProperty()
  displayUnit!: string;

  /** 스냅샷(또는 계획이면 현재 버전) 기준 영양. null 은 미상 */
  @ApiProperty({ type: NutritionValuesDto })
  nutrition!: NutritionValuesDto;

  @ApiProperty({
    enum: ['label', 'manual_estimate', 'ai_estimate', 'backfill'],
    nullable: true,
    type: String,
  })
  nutritionSource!: 'label' | 'manual_estimate' | 'ai_estimate' | 'backfill' | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  backfilledAt!: string | null;

  @ApiProperty()
  deductsStock!: boolean;

  /** 차감 후 원장이 음수 → '재고 확인 필요' (FR-03) */
  @ApiProperty()
  stockCheckNeeded!: boolean;

  @ApiProperty()
  isStockTracked!: boolean;

  /** 현재 제품 설정에서 입력 가능한 단위 (D-02). 제품이 삭제됐으면 스냅샷 단위만 */
  @ApiProperty({ enum: STOCK_UNITS, isArray: true })
  allowedUnits!: StockUnit[];

  /** 제품에 현재 영양 버전이 있는가(UI 의 '영양 미등록' 배지) */
  @ApiProperty()
  nutritionRegistered!: boolean;

  static fromSnapshot(
    s: MealItemSnapshot & { product: Product | null },
    version: ProductNutritionVersion | null,
  ): MealItemDto {
    const p = s.product;
    return {
      id: s.id,
      productId: s.productId,
      productName: s.productName,
      plannedQuantity: num(s.plannedQuantity),
      actualQuantity: num(s.actualQuantity),
      unit: s.unit,
      displayUnit: s.unit === 'ea' && p ? displayUnit(p) : s.unit,
      nutrition: {
        kcal: num(s.kcal),
        carbG: num(s.carbG),
        proteinG: num(s.proteinG),
        fatG: num(s.fatG),
      },
      nutritionSource: s.nutritionSource,
      backfilledAt: s.backfilledAt ? s.backfilledAt.toISOString() : null,
      deductsStock: s.deductsStock,
      stockCheckNeeded: s.stockCheckNeeded,
      isStockTracked: p ? p.isStockTracked : s.deductsStock,
      allowedUnits: p ? allowedUnits(p) : [s.unit],
      nutritionRegistered: version !== null,
    };
  }

  static planned(
    product: Product,
    quantity: number,
    unit: StockUnit,
    nutrition: NutritionValues,
    version: ProductNutritionVersion | null,
  ): MealItemDto {
    return {
      id: null,
      productId: product.id,
      productName: product.name,
      plannedQuantity: quantity,
      actualQuantity: null,
      unit,
      displayUnit: unit === 'ea' ? displayUnit(product) : unit,
      nutrition: NutritionValuesDto.from(nutrition),
      nutritionSource: null,
      backfilledAt: null,
      deductsStock: product.isStockTracked,
      stockCheckNeeded: false,
      isStockTracked: product.isStockTracked,
      allowedUnits: allowedUnits(product),
      nutritionRegistered: version !== null,
    };
  }
}

export interface RecordContext {
  date: string;
  slot: AnySlot;
  plan: ResolvedPlan;
  templateName: string | null;
  completionCleared?: boolean;
}

export class MealRecordDto {
  /** 저장된 레코드 id. 레코드가 없는 슬롯은 null (D-01: 미래 레코드를 만들지 않음) */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  id!: string | null;

  @ApiProperty({ example: '2026-11-06' })
  date!: string;

  @ApiProperty({ enum: [...MEAL_SLOTS, EXTRA_SLOT] })
  slot!: AnySlot;

  @ApiProperty({ enum: MEAL_STATUSES })
  status!: MealStatus;

  @ApiProperty({ enum: MEAL_KINDS })
  kind!: MealKind;

  /** 낙관적 잠금 값. 레코드 없음 = null (D-08) */
  @ApiProperty({ type: Number, nullable: true })
  version!: number | null;

  /** 그 날짜·슬롯의 적용 계획 (D-01). extra 는 항상 none */
  @ApiProperty({ enum: PLAN_TYPES })
  planType!: PlanType;

  @ApiProperty({ enum: ['override', 'weekly', 'default'] })
  planSource!: 'override' | 'weekly' | 'default';

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  templateId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  templateName!: string | null;

  /** 날짜 예외의 메모 (예: 출장). 예외가 아니면 null */
  @ApiProperty({ type: String, nullable: true })
  planNote!: string | null;

  /** 레코드 생성 시 계획이 예외에서 왔으면 true (실천율 분모 제외용) */
  @ApiProperty()
  planChanged!: boolean;

  @ApiProperty({ type: String, nullable: true })
  outsideMenu!: string | null;

  /** 외부 식사 직접 입력 영양. null 은 미상 */
  @ApiProperty({ type: NutritionValuesDto })
  outsideNutrition!: NutritionValuesDto;

  /** eaten: 실제 스냅샷. unrecorded: 계획 품목(가상, id null). skipped: 비어 있음 */
  @ApiProperty({ type: MealItemDto, isArray: true })
  items!: MealItemDto[];

  /** eaten: 실제 합계, skipped: 0(확인된 0), unrecorded: 계획 기준 예상 */
  @ApiProperty({ type: NutritionTotalsDto })
  nutrition!: NutritionTotalsDto;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  eatenAt!: string | null;

  /** 어떤 항목이든 재고 확인 필요 */
  @ApiProperty()
  stockCheckNeeded!: boolean;

  /** 이 쓰기로 하루 완료가 해제됐는가 (D-04). 조회 응답에서는 false */
  @ApiProperty()
  completionCleared!: boolean;

  static build(
    record: MealRecord | null,
    ctx: RecordContext,
    items: MealItemDto[],
    totals: NutritionTotals,
  ): MealRecordDto {
    return {
      id: record?.id ?? null,
      date: ctx.date,
      slot: ctx.slot,
      status: record?.status ?? 'unrecorded',
      kind: record?.kind ?? 'home',
      version: record?.version ?? null,
      planType: ctx.plan.planType,
      planSource: ctx.plan.source,
      templateId: record?.templateId ?? ctx.plan.templateId,
      templateName: ctx.templateName,
      planNote: ctx.plan.note ?? null,
      planChanged: record?.planChanged ?? false,
      outsideMenu: record?.outsideMenu ?? null,
      outsideNutrition: {
        kcal: num(record?.outsideKcal),
        carbG: num(record?.outsideCarbG),
        proteinG: num(record?.outsideProteinG),
        fatG: num(record?.outsideFatG),
      },
      items,
      nutrition: NutritionTotalsDto.from(totals),
      eatenAt: record?.eatenAt ? record.eatenAt.toISOString() : null,
      stockCheckNeeded: items.some((i) => i.stockCheckNeeded),
      completionCleared: ctx.completionCleared ?? false,
    };
  }
}

export class DayCompletionDto {
  @ApiProperty({ format: 'date-time' })
  completedAt!: string;

  @ApiProperty()
  nutritionComplete!: boolean;

  static from(c: DayCompletion): DayCompletionDto {
    return { completedAt: c.completedAt.toISOString(), nutritionComplete: c.nutritionComplete };
  }
}

export class DayNutritionDto {
  /** 먹었음·안 먹음·추가 간식의 실제 합계 ('기록된 합계') */
  @ApiProperty({ type: NutritionTotalsDto })
  recorded!: NutritionTotalsDto;

  /** 기록된 합계 + 미기록 슬롯의 계획 예상 */
  @ApiProperty({ type: NutritionTotalsDto })
  expected!: NutritionTotalsDto;

  @ApiProperty({ type: GoalDto, nullable: true })
  goal!: GoalDto | null;
}

export class DayDto {
  @ApiProperty({ example: '2026-11-06' })
  date!: string;

  @ApiProperty()
  isToday!: boolean;

  /** 쓰는 끼니(+기록이 있는 숨긴 끼니), 하루 순서 (D-18) */
  @ApiProperty({ type: MealRecordDto, isArray: true })
  slots!: MealRecordDto[];

  @ApiProperty({ type: MealRecordDto, isArray: true })
  extras!: MealRecordDto[];

  @ApiProperty({ type: DayNutritionDto })
  nutrition!: DayNutritionDto;

  /** 오늘이면 계획이 있고 아직 미기록인 첫 슬롯 */
  @ApiProperty({ enum: MEAL_SLOTS, nullable: true, type: String })
  nextSlot!: MealSlot | null;

  @ApiProperty({ type: WeightDto, nullable: true })
  weight!: WeightDto | null;

  @ApiProperty({ type: DayCompletionDto, nullable: true })
  completion!: DayCompletionDto | null;

  @ApiProperty()
  hasOverride!: boolean;
}

export class DaySummaryDto {
  @ApiProperty({ example: '2026-11-06' })
  date!: string;

  @ApiProperty()
  completed!: boolean;

  @ApiProperty()
  hasOverride!: boolean;

  /** 식단 외 식사(kind=outside) 로 먹은 기록이 있는가 */
  @ApiProperty()
  hasOutside!: boolean;

  /** 집계 대상 슬롯 수: 쓰는 끼니 중 계획이 있는 슬롯 + 기록된 자유 끼니 (D-18) */
  @ApiProperty()
  activeSlots!: number;

  /** 활성 슬롯 중 먹었음/안 먹음 처리된 수 */
  @ApiProperty()
  recordedSlots!: number;

  /** 오늘 이전·오늘의 미기록 활성 슬롯 수. 미래는 null */
  @ApiProperty({ type: Number, nullable: true })
  unrecordedCount!: number | null;
}
