import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import type { MealTemplate, MealTemplateItem, Product } from '@prisma/client';
import { NAME_MAX_LENGTH, STOCK_UNITS, displayUnit, type StockUnit } from '@diet/shared';
import { NutritionTotalsDto, NutritionValuesDto } from '../common/nutrition.dto';
import type { NutritionTotals, NutritionValues } from '../domain/nutrition';
import { numReq } from '../common/decimal';

export class TemplateItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 200 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;

  /** 제품 stock_unit, 또는 pack_weight_g 있는 ea 제품의 g (D-02) */
  @ApiProperty({ enum: STOCK_UNITS })
  @IsIn(STOCK_UNITS)
  unit!: StockUnit;
}

export class PutTemplateDto {
  @ApiProperty({ example: '평일 아침', maxLength: NAME_MAX_LENGTH })
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name!: string;

  /** 순서대로 sort_order 가 매겨진다. 빈 템플릿은 만들 수 없다(최소 1개, DEC-057) */
  @ApiProperty({ type: TemplateItemInputDto, isArray: true, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1, { message: '템플릿에는 품목이 1개 이상 필요합니다' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateItemInputDto)
  items!: TemplateItemInputDto[];
}

export class TemplateItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productArchived!: boolean;

  @ApiProperty()
  isStockTracked!: boolean;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ enum: STOCK_UNITS })
  unit!: StockUnit;

  /** 화면 표시 단위(g/ml 또는 unit_label) */
  @ApiProperty()
  displayUnit!: string;

  @ApiProperty()
  sortOrder!: number;

  /** 현재 영양 버전 기준 1회 영양. 미등록이면 전부 null */
  @ApiProperty({ type: NutritionValuesDto })
  nutrition!: NutritionValuesDto;

  static from(i: MealTemplateItem & { product: Product }, n: NutritionValues): TemplateItemDto {
    return {
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      productArchived: i.product.archivedAt !== null,
      isStockTracked: i.product.isStockTracked,
      quantity: numReq(i.quantity),
      unit: i.unit,
      displayUnit: i.unit === 'ea' ? displayUnit(i.product) : i.unit,
      sortOrder: i.sortOrder,
      nutrition: NutritionValuesDto.from(n),
    };
  }
}

export class TemplateUsageDto {
  /** 주간 반복 계획에서 쓰는 셀 수 */
  @ApiProperty()
  weeklyCells!: number;

  /** 오늘 이후 날짜 예외에서 쓰는 수 */
  @ApiProperty()
  upcomingOverrides!: number;
}

export class TemplateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: string | null;

  @ApiProperty({ type: TemplateItemDto, isArray: true })
  items!: TemplateItemDto[];

  /** 1회 영양 합계. complete=false 면 영양 미등록 제품 포함(불완전) */
  @ApiProperty({ type: NutritionTotalsDto })
  nutrition!: NutritionTotalsDto;

  @ApiProperty({ type: TemplateUsageDto })
  usage!: TemplateUsageDto;

  static from(
    t: MealTemplate,
    items: TemplateItemDto[],
    totals: NutritionTotals,
    usage: TemplateUsageDto,
  ): TemplateDto {
    return {
      id: t.id,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
      items,
      nutrition: NutritionTotalsDto.from(totals),
      usage,
    };
  }
}
