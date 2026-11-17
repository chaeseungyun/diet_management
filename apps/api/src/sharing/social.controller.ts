import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { DateParamPipe, UuidParamPipe } from '../common/validators';
import {
  CommentDto,
  CommentLikeDto,
  CreateCommentDto,
  RecordSocialDto,
  SetReactionDto,
} from './social.dto';
import { SocialService } from './social.service';

const RECORD = 'friends/:userId/meal-records/:recordId';

/**
 * 끼니 반응·댓글·댓글 좋아요 (sharing-plan §6, DEC-092, 공유-2a).
 * `userId` 는 기록의 소유자다. 댓글은 소유자 본인도 자기 userId 로 같은 경로를 쓴다.
 */
@ApiTags('sharing')
@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('days/:date/social')
  @ApiOperation({ summary: '내 하루의 기록별 반응 집계·댓글 수 (미기록 끼니는 없음)' })
  @ApiOkResponse({ type: RecordSocialDto, isArray: true })
  myDay(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
  ): Promise<RecordSocialDto[]> {
    return this.social.myDay(user, date);
  }

  @Put(`${RECORD}/reaction`)
  @ApiOperation({
    summary: '친구의 끼니에 반응(한 사람 1개, 다시 보내면 교체). 내 기록·볼 수 없는 기록은 404',
  })
  @ApiOkResponse({ type: RecordSocialDto })
  setReaction(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('recordId', UuidParamPipe) recordId: string,
    @Body() body: SetReactionDto,
  ): Promise<RecordSocialDto> {
    return this.social.setReaction(user, userId, recordId, body.emoji);
  }

  @Delete(`${RECORD}/reaction`)
  @ApiOperation({ summary: '내 반응 지우기(없어도 200)' })
  @ApiOkResponse({ type: RecordSocialDto })
  clearReaction(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('recordId', UuidParamPipe) recordId: string,
  ): Promise<RecordSocialDto> {
    return this.social.clearReaction(user, userId, recordId);
  }

  @Get(`${RECORD}/comments`)
  @ApiOperation({
    summary: '끼니의 댓글(오래된 순, 좋아요 수·내 좋아요 포함). 기록당 100개까지라 전부 준다',
  })
  @ApiOkResponse({ type: CommentDto, isArray: true })
  comments(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('recordId', UuidParamPipe) recordId: string,
  ): Promise<CommentDto[]> {
    return this.social.listComments(user, userId, recordId);
  }

  @Post(`${RECORD}/comments`)
  @HttpCode(201)
  @ApiOperation({ summary: '댓글 쓰기(1~500자). 응답은 갱신된 댓글 목록' })
  @ApiCreatedResponse({ type: CommentDto, isArray: true })
  addComment(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('recordId', UuidParamPipe) recordId: string,
    @Body() body: CreateCommentDto,
  ): Promise<CommentDto[]> {
    return this.social.addComment(user, userId, recordId, body.body);
  }

  @Delete(`${RECORD}/comments/:commentId`)
  @HttpCode(204)
  @ApiOperation({ summary: '댓글 삭제: 쓴 사람 또는 기록 소유자. 그 밖에는 404' })
  @ApiNoContentResponse()
  deleteComment(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('recordId', UuidParamPipe) recordId: string,
    @Param('commentId', UuidParamPipe) commentId: string,
  ): Promise<void> {
    return this.social.deleteComment(user, userId, recordId, commentId);
  }

  @Put('comments/:commentId/like')
  @ApiOperation({ summary: '댓글 좋아요(다시 보내도 1개). 댓글이 달린 기록을 볼 수 없으면 404' })
  @ApiOkResponse({ type: CommentLikeDto })
  like(
    @CurrentUser() user: User,
    @Param('commentId', UuidParamPipe) commentId: string,
  ): Promise<CommentLikeDto> {
    return this.social.setLike(user, commentId, true);
  }

  @Delete('comments/:commentId/like')
  @ApiOperation({ summary: '댓글 좋아요 취소' })
  @ApiOkResponse({ type: CommentLikeDto })
  unlike(
    @CurrentUser() user: User,
    @Param('commentId', UuidParamPipe) commentId: string,
  ): Promise<CommentLikeDto> {
    return this.social.setLike(user, commentId, false);
  }
}
