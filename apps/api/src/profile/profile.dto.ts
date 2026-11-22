import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { NICKNAME_MAX_LENGTH, STATUS_MESSAGE_MAX_LENGTH } from '@diet/shared';

/** 줄바꿈·연속 공백을 한 칸으로 줄이고 앞뒤를 뗀다(한 줄 문자열) */
const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

/**
 * 프로필 저장 본문(multipart 의 글자 필드, DEC-104). 통째로 바꾼다:
 * 닉네임은 필수, 상태 메시지는 없거나 비면 지운다. 사진은 `file` 이 있으면 바꾸고,
 * 없으면 `removeAvatar=true` 일 때만 지우며 그 밖에는 그대로 둔다.
 */
export class UpdateProfileDto {
  @ApiProperty({ minLength: 1, maxLength: NICKNAME_MAX_LENGTH })
  @Transform(oneLine)
  @IsString()
  @Length(1, NICKNAME_MAX_LENGTH)
  nickname!: string;

  @ApiPropertyOptional({ maxLength: STATUS_MESSAGE_MAX_LENGTH })
  @Transform(oneLine)
  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MESSAGE_MAX_LENGTH)
  statusMessage?: string;

  /** multipart 라 글자 'true' 로 온다 */
  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  removeAvatar?: boolean;
}

/** 남에게 보이는 프로필 (DEC-104). 이 필드만 나간다 */
export class ProfileDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  statusMessage!: string | null;

  /** 프로필 사진 id. 없으면 null. 파일은 `GET /profiles/{userId}/avatar` */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  avatarId!: string | null;

  @ApiProperty()
  isMe!: boolean;

  /** 지금 친구인가. 같은 친구가 있을 뿐인 사람은 false */
  @ApiProperty()
  isFriend!: boolean;
}
