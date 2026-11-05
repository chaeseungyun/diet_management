import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import type { User } from '@prisma/client';
import { NICKNAME_MAX_LENGTH, isValidTimezone } from '@diet/shared';

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

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(user: User): MeDto {
    const dto = new MeDto();
    dto.id = user.id;
    dto.nickname = user.nickname;
    dto.timezone = user.timezone;
    dto.onboardedAt = user.onboardedAt ? user.onboardedAt.toISOString() : null;
    dto.createdAt = user.createdAt.toISOString();
    return dto;
  }
}
