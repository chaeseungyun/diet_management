import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import type { Product, Purchase, StockReceipt } from '@prisma/client';
import { NOTE_MAX_LENGTH, STOCK_UNITS, type StockUnit } from '@diet/shared';
import { IsCalendarDate } from '../common/validators';
import { num, numReq } from '../common/decimal';
import { fromDbDate } from '../domain/dates';

export class CreatePurchaseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  /** 구매 수량(포장 단위) */
  @ApiProperty({ example: 30 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiProperty({ example: '2026-11-06' })
  @IsCalendarDate()
  purchasedOn!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  url?: string | null;

  /** true 면 즉시 입고 처리 (S-34 "이미 받았음") */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  received?: boolean;

  /** 즉시 입고 시 입고 수량(stock_unit). 생략하면 구매 수량 × units_per_package (D-11) */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  receivedQuantity?: number;
}

export class UpdatePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity?: number;

  @ApiPropertyOptional({ example: '2026-11-06' })
  @IsOptional()
  @IsCalendarDate()
  purchasedOn?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  url?: string | null;
}

export class ReceivePurchaseDto {
  /** 입고 수량(stock_unit). 생략하면 구매 수량 × units_per_package */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;
}

export class CreateReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  /** 현재 보유 수량(stock_unit) */
  @ApiProperty({ example: 12 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string | null;
}

export class ReceiptDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  purchaseId!: string | null;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  static from(r: StockReceipt): ReceiptDto {
    return {
      id: r.id,
      productId: r.productId,
      purchaseId: r.purchaseId,
      quantity: numReq(r.quantity),
      receivedAt: r.receivedAt.toISOString(),
    };
  }
}

export class PurchaseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ enum: STOCK_UNITS })
  stockUnit!: StockUnit;

  @ApiProperty({ type: String, nullable: true })
  unitLabel!: string | null;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ example: '2026-11-06' })
  purchasedOn!: string;

  @ApiProperty({ type: Number, nullable: true })
  price!: number | null;

  @ApiProperty({ type: String, nullable: true })
  url!: string | null;

  @ApiProperty({ enum: ['ordered', 'received', 'cancelled'] })
  status!: 'ordered' | 'received' | 'cancelled';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  /** 받았음 처리 시 입고 수량 기본값 = 구매 수량 × units_per_package (D-11) */
  @ApiProperty()
  defaultReceiveQuantity!: number;

  @ApiProperty({ type: ReceiptDto, nullable: true })
  receipt!: ReceiptDto | null;

  static from(p: Purchase & { product: Product; receipts: StockReceipt[] }): PurchaseDto {
    const r = p.receipts[0] ?? null;
    return {
      id: p.id,
      productId: p.productId,
      productName: p.product.name,
      stockUnit: p.product.stockUnit,
      unitLabel: p.product.unitLabel,
      quantity: numReq(p.quantity),
      purchasedOn: fromDbDate(p.purchasedOn),
      price: num(p.price),
      url: p.url,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      defaultReceiveQuantity: p.quantity.mul(p.product.unitsPerPackage).toNumber(),
      receipt: r ? ReceiptDto.from(r) : null,
    };
  }
}
