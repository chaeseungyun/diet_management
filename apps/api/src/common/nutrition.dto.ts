import { ApiProperty } from '@nestjs/swagger';
import type { NutritionTotals, NutritionValues } from '../domain/nutrition';
import { num } from './decimal';

/** 영양값. null 은 미상 (NFR-02) */
export class NutritionValuesDto {
  @ApiProperty({ type: Number, nullable: true })
  kcal!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  carbG!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  proteinG!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fatG!: number | null;

  static from(v: NutritionValues): NutritionValuesDto {
    return { kcal: num(v.kcal), carbG: num(v.carbG), proteinG: num(v.proteinG), fatG: num(v.fatG) };
  }
}

/** 합계. complete=false 면 미상 항목이 섞인 '기록된 합계' (FR-06) */
export class NutritionTotalsDto {
  @ApiProperty()
  kcal!: number;

  @ApiProperty()
  carbG!: number;

  @ApiProperty()
  proteinG!: number;

  @ApiProperty()
  fatG!: number;

  @ApiProperty()
  complete!: boolean;

  /** kcal 미상 항목 수 */
  @ApiProperty()
  missing!: number;

  static from(t: NutritionTotals): NutritionTotalsDto {
    return {
      kcal: t.kcal.toNumber(),
      carbG: t.carbG.toNumber(),
      proteinG: t.proteinG.toNumber(),
      fatG: t.fatG.toNumber(),
      complete: t.complete,
      missing: t.missing,
    };
  }
}
