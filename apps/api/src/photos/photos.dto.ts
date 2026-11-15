import { ApiProperty } from '@nestjs/swagger';
import type { MealPhoto } from '@prisma/client';

/**
 * 식사 사진 (EXT-02a). 파일은 `GET /meal-photos/{id}`(보기용)·`?size=thumb`(썸네일)로 받는다.
 * 보관 기간이 지난 사진은 expired=true 자리만 남는다(파일 없음, DEC-069).
 */
export class MealPhotoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** 붙은 기록. 아직 기록 저장 전인 임시 사진은 null */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  mealRecordId!: string | null;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  /** 보관 기간 지남. 파일 요청은 404 */
  @ApiProperty()
  expired!: boolean;

  static from(p: MealPhoto, now: Date = new Date()): MealPhotoDto {
    return {
      id: p.id,
      mealRecordId: p.mealRecordId,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      expired: p.purgedAt !== null || p.expiresAt.getTime() <= now.getTime(),
    };
  }
}
