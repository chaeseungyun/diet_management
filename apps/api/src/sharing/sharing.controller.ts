import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser, Public } from '../auth/auth.guard';
import { DateParamPipe, UuidParamPipe } from '../common/validators';
import { PhotosService } from '../photos/photos.service';
import { sendPhoto } from '../photos/photo-response';
import { FriendsService } from './friends.service';
import {
  BlockedUserDto,
  FriendDto,
  FriendInviteDto,
  FriendInvitePreviewDto,
  SharedDayDto,
  SharingSettingsDto,
  UpdateFriendDto,
} from './sharing.dto';

/** 끼니 공유 (sharing-plan §6, DEC-066·090, S-80~S-84). 공유-1a: 초대 링크·공개 범위·친구의 하루 */
@ApiTags('sharing')
@Controller()
export class SharingController {
  constructor(
    private readonly friends: FriendsService,
    private readonly photos: PhotosService,
  ) {}

  @Get('me/sharing')
  @ApiOperation({ summary: '내 끼니 공개 범위' })
  @ApiOkResponse({ type: SharingSettingsDto })
  sharing(@CurrentUser() user: User): SharingSettingsDto {
    return this.friends.getSharing(user);
  }

  @Put('me/sharing')
  @ApiOperation({
    summary: '공개 범위 바꾸기. private 로 바꾸면 모든 친구에게 즉시 안 보인다',
  })
  @ApiOkResponse({ type: SharingSettingsDto })
  setSharing(
    @CurrentUser() user: User,
    @Body() body: SharingSettingsDto,
  ): Promise<SharingSettingsDto> {
    return this.friends.setSharing(user, body.visibility);
  }

  @Post('friend-invites')
  @HttpCode(201)
  @ApiOperation({ summary: '초대 링크 만들기(1회용, 7일). 쓸 수 있는 링크는 5개까지' })
  @ApiCreatedResponse({ type: FriendInviteDto })
  createInvite(@CurrentUser() user: User): Promise<FriendInviteDto> {
    return this.friends.createInvite(user);
  }

  @Get('friend-invites')
  @ApiOperation({ summary: '아직 쓸 수 있는 내 초대 링크' })
  @ApiOkResponse({ type: FriendInviteDto, isArray: true })
  invites(@CurrentUser() user: User): Promise<FriendInviteDto[]> {
    return this.friends.listInvites(user);
  }

  @Public()
  @Get('friend-invites/:code')
  @ApiOperation({
    summary: '초대 링크 미리보기(로그인 불필요): 초대한 사람의 닉네임. 만료·소진·철회는 404',
  })
  @ApiOkResponse({ type: FriendInvitePreviewDto })
  previewInvite(@Param('code') code: string): Promise<FriendInvitePreviewDto> {
    return this.friends.previewInvite(code);
  }

  @Post('friend-invites/:code/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: '초대 수락 → 즉시 친구. 내 링크·이미 친구는 422, 쓸 수 없는 링크는 404',
  })
  @ApiOkResponse({ type: FriendDto })
  acceptInvite(@CurrentUser() user: User, @Param('code') code: string): Promise<FriendDto> {
    return this.friends.acceptInvite(user, code);
  }

  @Delete('friend-invites/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '초대 링크 철회' })
  @ApiNoContentResponse()
  revokeInvite(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    return this.friends.revokeInvite(user, id);
  }

  @Get('friends')
  @ApiOperation({ summary: '친구 목록 + 볼 수 있는 친구의 오늘 요약' })
  @ApiOkResponse({ type: FriendDto, isArray: true })
  list(@CurrentUser() user: User): Promise<FriendDto[]> {
    return this.friends.listFriends(user);
  }

  @Get('friends/blocked')
  @ApiOperation({ summary: '내가 차단한 사람 목록' })
  @ApiOkResponse({ type: BlockedUserDto, isArray: true })
  listBlocked(@CurrentUser() user: User): Promise<BlockedUserDto[]> {
    return this.friends.listBlocked(user);
  }

  @Post('friends/:userId/block')
  @HttpCode(204)
  @ApiOperation({ summary: '친구 차단(친구 끊기 + 다시 친구 맺기·서로의 반응·댓글·알림 막기)' })
  @ApiNoContentResponse()
  block(@CurrentUser() user: User, @Param('userId', UuidParamPipe) userId: string): Promise<void> {
    return this.friends.block(user, userId);
  }

  @Delete('friends/:userId/block')
  @HttpCode(204)
  @ApiOperation({ summary: '차단 해제(친구로 돌아가지 않음)' })
  @ApiNoContentResponse()
  unblock(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
  ): Promise<void> {
    return this.friends.unblock(user, userId);
  }

  @Patch('friends/:userId')
  @ApiOperation({ summary: '이 친구에게만 내 끼니 끄기·켜기' })
  @ApiOkResponse({ type: FriendDto })
  update(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Body() body: UpdateFriendDto,
  ): Promise<FriendDto> {
    return this.friends.setShareToFriend(user, userId, body.shareToFriend);
  }

  @Delete('friends/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: '친구 끊기(양쪽 즉시)' })
  @ApiNoContentResponse()
  unfriend(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
  ): Promise<void> {
    return this.friends.unfriend(user, userId);
  }

  @Get('friends/:userId/days/:date')
  @ApiOperation({
    summary:
      '친구의 하루(읽기 전용): 끼니 상태·먹은 품목·식단 외 메뉴명·사진·영양 합계·완료. 볼 수 없으면 404',
  })
  @ApiOkResponse({ type: SharedDayDto })
  day(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('date', DateParamPipe) date: string,
  ): Promise<SharedDayDto> {
    return this.friends.sharedDay(user, userId, date);
  }

  @Get('friends/:userId/meal-photos/:photoId')
  @ApiOperation({ summary: '친구의 식사 사진 파일(JPEG). 볼 수 없으면 404' })
  @ApiQuery({ name: 'size', required: false, enum: ['view', 'thumb'] })
  @ApiProduces('image/jpeg')
  async photo(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Param('photoId', UuidParamPipe) photoId: string,
    @Query('size') size: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const variant = size === 'thumb' ? 'thumb' : 'view';
    const owner = await this.friends.photoOwner(user, userId);
    // 기록에 붙은 사진만: 저장 전 임시 사진은 친구에게 보이지 않는다
    const opened = await this.photos.open(owner, photoId, variant, new Date(), {
      attachedOnly: true,
    });
    return sendPhoto(req, res, photoId, variant, opened);
  }
}
