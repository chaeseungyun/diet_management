import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { COMMENT_MAX_LENGTH, REACTION_EMOJIS } from '@diet/shared';

export class SetReactionDto {
  /** 허용 목록(`REACTION_EMOJIS`)의 이모지 하나 */
  @ApiProperty({ enum: REACTION_EMOJIS })
  @IsIn(REACTION_EMOJIS)
  emoji!: string;
}

export class ReactionCountDto {
  @ApiProperty({ enum: REACTION_EMOJIS })
  emoji!: string;

  @ApiProperty()
  count!: number;
}

/** 기록 하나의 반응 집계·내 반응·댓글 수. 누가 눌렀는지는 싣지 않는다 */
export class RecordSocialDto {
  @ApiProperty({ format: 'uuid' })
  recordId!: string;

  /** 눌린 이모지만, 허용 목록 순서 */
  @ApiProperty({ type: ReactionCountDto, isArray: true })
  reactions!: ReactionCountDto[];

  /** 내가 누른 이모지. 없으면 null (기록 소유자는 반응하지 않으므로 늘 null) */
  @ApiProperty({ type: String, nullable: true })
  myReaction!: string | null;

  @ApiProperty()
  commentCount!: number;
}

export class CreateCommentDto {
  /** 앞뒤 공백을 뗀 1~500자 */
  @ApiProperty({ minLength: 1, maxLength: COMMENT_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(COMMENT_MAX_LENGTH)
  body!: string;
}

export class CommentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nickname!: string;

  /** 쓴 사람의 프로필 사진 id (DEC-104). 없으면 null. 파일은 `GET /profiles/{userId}/avatar` */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  avatarId!: string | null;

  @ApiProperty()
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty()
  likeCount!: number;

  @ApiProperty()
  likedByMe!: boolean;

  /** 내가 쓴 댓글 */
  @ApiProperty()
  mine!: boolean;

  /** 내가 지울 수 있는가: 내가 썼거나 내 기록에 달린 댓글 */
  @ApiProperty()
  canDelete!: boolean;
}

export class CommentLikeDto {
  @ApiProperty()
  likeCount!: number;

  @ApiProperty()
  likedByMe!: boolean;
}
