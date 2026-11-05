/**
 * 영양 계산 (FR-02, FR-06, NFR-02). null 은 미상, 0 은 확인된 0.
 * 기준량(basis)과 섭취량을 분리한다: "가루 45g ≠ 단백질 45g".
 */
import type { StockUnit } from '@prisma/client';
import { convertQuantity, Decimal, round3, type UnitProduct } from './units';

export interface NutritionValues {
  kcal: Decimal | null;
  carbG: Decimal | null;
  proteinG: Decimal | null;
  fatG: Decimal | null;
}

export interface NutritionBasis extends NutritionValues {
  basisAmount: Decimal;
  basisUnit: StockUnit;
}

export const UNKNOWN_NUTRITION: NutritionValues = {
  kcal: null,
  carbG: null,
  proteinG: null,
  fatG: null,
};

/**
 * 섭취량 × (영양/기준량). 섭취 단위를 기준 단위로 변환할 수 없으면 전부 미상.
 * 영양 미상(null) 필드는 미상으로 남긴다.
 */
export function computeNutrition(
  basis: NutritionBasis | null,
  quantity: Decimal | null,
  unit: StockUnit,
  product: UnitProduct,
): NutritionValues {
  if (!basis || quantity === null || basis.basisAmount.lte(0)) return UNKNOWN_NUTRITION;
  const inBasis = convertQuantity(quantity, unit, basis.basisUnit, product);
  if (inBasis === null) return UNKNOWN_NUTRITION;
  const ratio = inBasis.div(basis.basisAmount);
  const scale = (v: Decimal | null): Decimal | null => (v === null ? null : round3(v.mul(ratio)));
  return {
    kcal: scale(basis.kcal),
    carbG: scale(basis.carbG),
    proteinG: scale(basis.proteinG),
    fatG: scale(basis.fatG),
  };
}

export interface NutritionTotals {
  kcal: Decimal;
  carbG: Decimal;
  proteinG: Decimal;
  fatG: Decimal;
  /** 모든 항목의 kcal 이 확인됐는가 (erd §4-6 영양 완전 판정) */
  complete: boolean;
  /** kcal 미상 항목 수 */
  missing: number;
}

/** 합계는 확인된 값만 더한다. 미상이 섞이면 complete=false 로 '기록된 합계'임을 알린다. */
export function sumNutrition(parts: readonly NutritionValues[]): NutritionTotals {
  const totals: NutritionTotals = {
    kcal: new Decimal(0),
    carbG: new Decimal(0),
    proteinG: new Decimal(0),
    fatG: new Decimal(0),
    complete: true,
    missing: 0,
  };
  for (const p of parts) {
    if (p.kcal === null) {
      totals.complete = false;
      totals.missing += 1;
    } else {
      totals.kcal = totals.kcal.add(p.kcal);
    }
    if (p.carbG !== null) totals.carbG = totals.carbG.add(p.carbG);
    if (p.proteinG !== null) totals.proteinG = totals.proteinG.add(p.proteinG);
    if (p.fatG !== null) totals.fatG = totals.fatG.add(p.fatG);
  }
  return totals;
}

export function addTotals(a: NutritionTotals, b: NutritionTotals): NutritionTotals {
  return {
    kcal: a.kcal.add(b.kcal),
    carbG: a.carbG.add(b.carbG),
    proteinG: a.proteinG.add(b.proteinG),
    fatG: a.fatG.add(b.fatG),
    complete: a.complete && b.complete,
    missing: a.missing + b.missing,
  };
}
