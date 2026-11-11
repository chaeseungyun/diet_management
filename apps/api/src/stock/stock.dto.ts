import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { NOTE_MAX_LENGTH, STOCK_UNITS, type StockUnit } from '@diet/shared';

/**
 * 남은 양 맞추기 — 실측 잔량 보정 (S-42 중 '실측 잔량', api.md §5, DEC-078).
 * 서버가 (실측 잔량 − 현재 원장 합계) 만큼 reason=adjust 이동을 만든다.
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

  /** 이번 보정으로 생긴 변화량(stock_unit). 0 이면 이동을 만들지 않았다 */
  @ApiProperty()
  delta!: number;

  /** 보정 뒤 남은 양(stock_unit) */
  @ApiProperty()
  currentStock!: number;

  /** 만든 원장 이동. 차이가 없으면 null */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  movementId!: string | null;
}
