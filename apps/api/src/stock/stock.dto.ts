import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  MEAL_SLOTS,
  NOTE_MAX_LENGTH,
  STOCK_UNITS,
  type AnySlot,
  type StockUnit,
} from '@diet/shared';
import { STOCK_LEVELS, type StockLevel } from '../domain/forecast';

export const STOCK_MOVEMENT_REASONS = [
  'receipt',
  'initial',
  'consume',
  'consume_reverse',
  'adjust',
  'waste',
  'other_use',
] as const;
export type StockMovementReasonName = (typeof STOCK_MOVEMENT_REASONS)[number];

/**
 * 남은 양 맞추기 (api.md §5, DEC-078). 서버가 (실측 잔량 − 현재 합계) 만큼 reason=adjust 이동을
 * 만든다(차이 0 도 남김). 버리거나 남에게 준 양도 이것으로 반영한다(DEC-081).
 */
export class CreateAdjustmentDto {
  /** 지금 실제로 남은 양(unit 기준). 0 이상 */
  @ApiProperty({ example: 0.6 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  measuredQuantity!: number;

  /** 입력 단위. 생략하면 제품의 stock_unit. ea 제품은 단위 중량이 있을 때만 g (D-02) */
  @ApiPropertyOptional({ enum: STOCK_UNITS })
  @IsOptional()
  @IsIn(STOCK_UNITS)
  unit?: StockUnit;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string | null;
}

export class AdjustmentResultDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  /** 이번 보정으로 생긴 변화량(stock_unit). 맞추기에서 기록과 같았으면 0 */
  @ApiProperty()
  delta!: number;

  /** 보정 뒤 남은 양(stock_unit) */
  @ApiProperty()
  currentStock!: number;

  /** 만든 원장 이동. 차이가 0 인 맞추기도 '확인했다' 는 이동을 남긴다 (DEC-080 4) */
  @ApiProperty({ format: 'uuid' })
  movementId!: string;
}

/** 남은 양·소진 예측의 제품 한 줄 (S-30·S-32·S-10 ⑦, FR-08, DEC-080·081) */
export class StockItemDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  brand!: string | null;

  @ApiProperty({ enum: STOCK_UNITS })
  stockUnit!: StockUnit;

  @ApiProperty({ type: String, nullable: true })
  unitLabel!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  packWeightG!: number | null;

  /** 원장 합계(stock_unit). 재고 비관리 제품은 null. 음수는 그대로 */
  @ApiProperty({ type: Number, nullable: true })
  currentStock!: number | null;

  /** 배송 중 수량(stock_unit 환산). 재고·예측에 넣지 않는다 */
  @ApiProperty()
  orderedQuantity!: number;

  /** 수준 배지. 하나만 붙는다 */
  @ApiProperty({ enum: STOCK_LEVELS })
  level!: StockLevel;

  /** 남은 양으로 필요량을 못 채우는 첫 끼니의 날짜. 예측하지 않거나 범위 안에 없으면 null */
  @ApiProperty({ type: String, nullable: true, example: '2026-11-20' })
  depletionDate!: string | null;

  /** 오늘부터 소진일까지 일수(오늘이면 0) */
  @ApiProperty({ type: Number, nullable: true })
  daysLeft!: number | null;

  /** 예정 소비가 있는데 계산 범위를 넘겨도 남는다 */
  @ApiProperty()
  beyondHorizon!: boolean;

  /** 마지막 남은 양 맞추기 뒤, 이 식품이 든 과거 식단 끼니에 미기록이 있다 */
  @ApiProperty()
  lowConfidence!: boolean;

  @ApiProperty({ type: String, nullable: true })
  purchaseUrl!: string | null;
}

export class StockOverviewDto {
  /** 사용자 시간대의 오늘 */
  @ApiProperty({ example: '2026-11-12' })
  today!: string;

  /** 소진 임박 기준 N일 (소진 알림 설정과 같은 값) */
  @ApiProperty()
  daysBefore!: number;

  /** 오늘을 포함해 며칠을 계산했는가 */
  @ApiProperty()
  horizonDays!: number;

  /** 할 일이 있는 것부터: 확인 필요 → 다 먹음 → 소진일 빠른 순 → 예측 불가 → 수량 안 셈 */
  @ApiProperty({ type: StockItemDto, isArray: true })
  items!: StockItemDto[];
}

/** 식품 하나의 남은 양·소진 예측 (S-32). 보관한 식품도 조회된다 */
export class StockDetailDto extends StockItemDto {
  @ApiProperty({ example: '2026-11-12' })
  today!: string;

  @ApiProperty()
  daysBefore!: number;

  @ApiProperty()
  horizonDays!: number;

  @ApiProperty()
  archived!: boolean;
}

export class MovementMealDto {
  @ApiProperty({ example: '2026-11-12' })
  date!: string;

  @ApiProperty({ enum: [...MEAL_SLOTS, 'extra'] })
  slot!: AnySlot;
}

/** 원장 한 줄 (S-32). 수정·삭제 API 는 없다 */
export class StockMovementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** 부호 있는 변화량(stock_unit) */
  @ApiProperty()
  delta!: number;

  @ApiProperty({ enum: STOCK_MOVEMENT_REASONS })
  reason!: StockMovementReasonName;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** 섭취 차감·복구와 연결된 식사 */
  @ApiProperty({ type: MovementMealDto, nullable: true })
  meal!: MovementMealDto | null;
}

export class StockMovementPageDto {
  /** 최근 것부터 */
  @ApiProperty({ type: StockMovementDto, isArray: true })
  items!: StockMovementDto[];

  /** 다음 쪽이 있으면 `cursor` 로 보낼 값 */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  nextCursor!: string | null;
}

/** 계획 변경으로 소진일이 바뀐 식품 (S-24, DEC-080 14) */
export class DepletionChangeDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty()
  name!: string;

  /** 바꾸기 전 소진일. null = 계산 범위 안에 없음 */
  @ApiProperty({ type: String, nullable: true })
  before!: string | null;

  @ApiProperty({ type: String, nullable: true })
  after!: string | null;
}
