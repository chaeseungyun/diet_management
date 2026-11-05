/**
 * 단위 규칙 (D-02, D-11, DEC-018). 임의 환산을 하지 않는다.
 * - 입력 단위는 제품의 stock_unit, 또는 pack_weight_g 가 있는 ea 제품에 한해 g.
 * - ea↔g 변환은 pack_weight_g 가 있을 때만. 그 외 조합은 null(변환 불가).
 */
import { Prisma } from '@prisma/client';
import type { StockUnit } from '@prisma/client';

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export interface UnitProduct {
  stockUnit: StockUnit;
  packWeightG: Decimal | null;
}

export function allowedUnits(p: UnitProduct): StockUnit[] {
  return p.stockUnit === 'ea' && p.packWeightG ? ['ea', 'g'] : [p.stockUnit];
}

export function isAllowedUnit(p: UnitProduct, unit: StockUnit): boolean {
  return allowedUnits(p).includes(unit);
}

/** from 단위 수량을 to 단위로. 변환 불가면 null. */
export function convertQuantity(
  qty: Decimal,
  from: StockUnit,
  to: StockUnit,
  p: UnitProduct,
): Decimal | null {
  if (from === to) return qty;
  if (!p.packWeightG || p.packWeightG.lte(0)) return null;
  if (from === 'g' && to === 'ea') return qty.div(p.packWeightG);
  if (from === 'ea' && to === 'g') return qty.mul(p.packWeightG);
  return null;
}

/** 섭취·템플릿 수량을 재고 원장 단위로 (차감량 계산) */
export function toStockUnit(qty: Decimal, unit: StockUnit, p: UnitProduct): Decimal | null {
  return convertQuantity(qty, unit, p.stockUnit, p);
}

/** 영양 기준 단위 허용 여부: stock_unit 과 같거나, pack_weight_g 있는 ea 제품의 g (D-11) */
export function isAllowedBasisUnit(p: UnitProduct, basisUnit: StockUnit): boolean {
  return isAllowedUnit(p, basisUnit);
}

/** Decimal 소수 3자리 (DB 컬럼 정밀도와 동일). 표시 반올림은 화면 몫이고 이것은 저장 정밀도다. */
export function round3(d: Decimal): Decimal {
  return d.toDecimalPlaces(3);
}
