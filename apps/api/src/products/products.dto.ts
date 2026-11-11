import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import type { Product, ProductNutritionVersion, Purchase, StockReceipt } from '@prisma/client';
import { NAME_MAX_LENGTH, STOCK_UNITS, type StockUnit } from '@diet/shared';
import { num, numReq } from '../common/decimal';
import { fromDbDate } from '../domain/dates';
import { allowedUnits } from '../domain/units';

export class CreateProductDto {
  @ApiProperty({ example: '닭가슴살 100g', maxLength: NAME_MAX_LENGTH })
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  brand?: string | null;

  /** 재고 원장 단위. 이동이 생기면 바꿀 수 없다 (D-13) */
  @ApiProperty({ enum: STOCK_UNITS })
  @IsIn(STOCK_UNITS)
  stockUnit!: StockUnit;

  /** ea 제품의 표시 단위명(팩·개·통). ea 면 필수, g/ml 면 무시 (D-11) */
  @ApiPropertyOptional({ type: String, nullable: true, example: '팩' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unitLabel?: string | null;

  /** 포장 1개 = 재고 단위 N. 입고 기본값 = 구매 수량 × N (D-11). 기본 1 */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  unitsPerPackage?: number;

  /** ea 1단위의 g. 있을 때만 ea↔g 변환 (D-02). g/ml 제품은 null */
  @ApiPropertyOptional({ type: Number, nullable: true, example: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  packWeightG?: number | null;

  /** false = 소스처럼 재고 차감 제외 (D-09). 기본 true */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isStockTracked?: boolean;

  /** 소스 기본 추정 섭취량(stock_unit 기준). 이 값으로 계산한 영양은 출처 manual_estimate */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  defaultServingAmount?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  purchaseUrl?: string | null;

  /** 기존 보유 수량(stock_unit 기준). 있으면 StockReceipt(purchase 없음) + StockMovement(initial) 을 같이 만든다 */
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  initialStock?: number;
}

export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['initialStock'])) {}

export class NutritionVersionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  basisAmount!: number;

  @ApiProperty({ enum: STOCK_UNITS })
  basisUnit!: StockUnit;

  @ApiProperty({ type: Number, nullable: true })
  kcal!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  carbG!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  proteinG!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fatG!: number | null;

  @ApiProperty({ enum: ['label', 'manual_estimate', 'ai_estimate'] })
  source!: 'label' | 'manual_estimate' | 'ai_estimate';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  supersededAt!: string | null;

  static from(v: ProductNutritionVersion): NutritionVersionDto {
    return {
      id: v.id,
      basisAmount: numReq(v.basisAmount),
      basisUnit: v.basisUnit,
      kcal: num(v.kcal),
      carbG: num(v.carbG),
      proteinG: num(v.proteinG),
      fatG: num(v.fatG),
      source: v.source,
      createdAt: v.createdAt.toISOString(),
      supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
    };
  }
}

export class CreateNutritionDto {
  /** 기준량. "1회분" 은 재고 단위 수량(예: 30)으로 적는다 (D-11) */
  @ApiProperty({ example: 100 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  basisAmount!: number;

  /** 제품 stock_unit 과 같거나, pack_weight_g 있는 ea 제품에 한해 g (D-11). 아니면 422 */
  @ApiProperty({ enum: STOCK_UNITS })
  @IsIn(STOCK_UNITS)
  basisUnit!: StockUnit;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  kcal?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  carbG?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  proteinG?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  fatG?: number | null;

  /** ai_estimate 는 확장 단계(EXT-01)에서만 생긴다 */
  @ApiProperty({ enum: ['label', 'manual_estimate'] })
  @IsIn(['label', 'manual_estimate'])
  source!: 'label' | 'manual_estimate';
}

export class NutritionSaveResultDto {
  @ApiProperty({ type: NutritionVersionDto })
  version!: NutritionVersionDto;

  /** 이 제품의 영양 미상 스냅샷 수. 0 보다 크면 S-33 이 D-03 확인 다이얼로그를 띄운다 */
  @ApiProperty()
  unknownSnapshotCount!: number;
}

export class BackfillResultDto {
  /** 채운 스냅샷 수 */
  @ApiProperty()
  updated!: number;

  /** 수량·단위로 계산할 수 없어 남긴 수 */
  @ApiProperty()
  skipped!: number;
}

export class ProductPurchaseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ example: '2026-11-06' })
  purchasedOn!: string;

  @ApiProperty({ type: Number, nullable: true })
  price!: number | null;

  @ApiProperty({ enum: ['ordered', 'received', 'cancelled'] })
  status!: 'ordered' | 'received' | 'cancelled';

  @ApiProperty({ type: Number, nullable: true })
  receivedQuantity!: number | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  receivedAt!: string | null;

  static from(p: Purchase & { receipts: StockReceipt[] }): ProductPurchaseDto {
    const r = p.receipts[0] ?? null;
    return {
      id: p.id,
      quantity: numReq(p.quantity),
      purchasedOn: fromDbDate(p.purchasedOn),
      price: num(p.price),
      status: p.status,
      receivedQuantity: r ? numReq(r.quantity) : null,
      receivedAt: r ? r.receivedAt.toISOString() : null,
    };
  }
}

export class ProductRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export interface ProductExtras {
  nutrition: ProductNutritionVersion | null;
  currentStock: number | null;
  orderedQuantity: number;
}

export class ProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  brand!: string | null;

  @ApiProperty({ enum: STOCK_UNITS })
  stockUnit!: StockUnit;

  @ApiProperty({ type: String, nullable: true })
  unitLabel!: string | null;

  @ApiProperty()
  unitsPerPackage!: number;

  @ApiProperty({ type: Number, nullable: true })
  packWeightG!: number | null;

  @ApiProperty()
  isStockTracked!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  defaultServingAmount!: number | null;

  @ApiProperty({ type: String, nullable: true })
  purchaseUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: string | null;

  /** 현재 영양 버전. null = 영양 정보 미등록 */
  @ApiProperty({ type: NutritionVersionDto, nullable: true })
  nutrition!: NutritionVersionDto | null;

  /** 원장 합계(stock_unit). 재고 비관리 제품은 null. 음수는 그대로 (재고 확인 필요) */
  @ApiProperty({ type: Number, nullable: true })
  currentStock!: number | null;

  /** 배송 중 수량(stock_unit 환산). 재고에 포함하지 않는다 */
  @ApiProperty()
  orderedQuantity!: number;

  /** 섭취·템플릿 입력에 허용되는 단위 (D-02) */
  @ApiProperty({ enum: STOCK_UNITS, isArray: true })
  allowedUnits!: StockUnit[];

  static from(p: Product, x: ProductExtras): ProductDto {
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      stockUnit: p.stockUnit,
      unitLabel: p.unitLabel,
      unitsPerPackage: numReq(p.unitsPerPackage),
      packWeightG: num(p.packWeightG),
      isStockTracked: p.isStockTracked,
      defaultServingAmount: num(p.defaultServingAmount),
      purchaseUrl: p.purchaseUrl,
      createdAt: p.createdAt.toISOString(),
      archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
      nutrition: x.nutrition ? NutritionVersionDto.from(x.nutrition) : null,
      currentStock: x.currentStock,
      orderedQuantity: x.orderedQuantity,
      allowedUnits: allowedUnits(p),
    };
  }
}

export class ProductDetailDto extends ProductDto {
  @ApiProperty({ type: ProductPurchaseDto, isArray: true })
  purchases!: ProductPurchaseDto[];

  /** 이 제품을 쓰는 보관되지 않은 템플릿 */
  @ApiProperty({ type: ProductRefDto, isArray: true })
  templates!: ProductRefDto[];

  /** 원장 이동이 있어 stock_unit 을 바꿀 수 없다 (D-13). 수정 화면이 단위 선택을 잠근다 */
  @ApiProperty()
  stockUnitLocked!: boolean;
}
