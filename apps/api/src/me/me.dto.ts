import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import type { User } from '@prisma/client';
import { MEAL_SLOTS, NICKNAME_MAX_LENGTH, isValidTimezone, type MealSlot } from '@diet/shared';

/** IANA 시간대 검증 데코레이터 */
function IsTimezone(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isTimezone',
      target: object.constructor,
      propertyName,
      options: { message: 'timezone must be a valid IANA time zone', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidTimezone(value),
      },
    });
  };
}

export class UpdateMeDto {
  @ApiPropertyOptional({ maxLength: NICKNAME_MAX_LENGTH, example: '승윤' })
  @IsOptional()
  @IsString()
  @Length(1, NICKNAME_MAX_LENGTH)
  nickname?: string;

  @ApiPropertyOptional({
    example: 'Asia/Seoul',
    description: 'IANA 시간대. 변경 시 날짜 경계와 알림 예약이 바뀐다',
  })
  @IsOptional()
  @IsTimezone()
  timezone?: string;

  @ApiPropertyOptional({ description: 'true 면 첫 설정(S-03) 완료로 표시한다' })
  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;

  /** 오늘 화면·주간 계획에 보이는 끼니(D-18). 1개 이상, extra 불가. 숨긴 끼니도 기록이 있으면 보인다 */
  @ApiPropertyOptional({ enum: MEAL_SLOTS, isArray: true, minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '쓰는 끼니는 1개 이상이어야 합니다' })
  @ArrayUnique()
  @IsIn(MEAL_SLOTS, { each: true })
  activeSlots?: MealSlot[];
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ example: 'Asia/Seoul' })
  timezone!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  onboardedAt!: string | null;

  /** 쓰는 끼니, 하루 순서 (D-18) */
  @ApiProperty({ enum: MEAL_SLOTS, isArray: true })
  activeSlots!: MealSlot[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(user: User): MeDto {
    const dto = new MeDto();
    dto.id = user.id;
    dto.nickname = user.nickname;
    dto.timezone = user.timezone;
    dto.onboardedAt = user.onboardedAt ? user.onboardedAt.toISOString() : null;
    dto.activeSlots = MEAL_SLOTS.filter((s) => (user.activeSlots as string[]).includes(s));
    dto.createdAt = user.createdAt.toISOString();
    return dto;
  }
}
