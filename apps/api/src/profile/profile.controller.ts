import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import {
  NICKNAME_MAX_LENGTH,
  PHOTO_MAX_UPLOAD_BYTES,
  STATUS_MESSAGE_MAX_LENGTH,
} from '@diet/shared';
import { CurrentUser } from '../auth/auth.guard';
import { UuidParamPipe } from '../common/validators';
import { MeDto } from '../me/me.dto';
import { sendPhoto } from '../photos/photo-response';
import { ProfileDto, UpdateProfileDto } from './profile.dto';
import { ProfileService } from './profile.service';

/** 프로필 (DEC-104, S-74·S-87). 사진 파일은 접근 판정 뒤 API 가 직접 흘려보낸다 */
@ApiTags('profile')
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Put('me/profile')
  // 저장소 옵션을 주지 않으면 메모리에 받는다 → 원본이 디스크에 남지 않는다
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_UPLOAD_BYTES, files: 1 } }),
  )
  @ApiOperation({
    summary:
      '내 프로필 저장: 닉네임·상태 메시지·사진을 요청 하나로. 사진은 JPEG·PNG·WebP, 10 MB 초과는 413. file 이 없으면 사진은 그대로(removeAvatar=true 면 지움)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['nickname'],
      properties: {
        nickname: { type: 'string', minLength: 1, maxLength: NICKNAME_MAX_LENGTH },
        statusMessage: { type: 'string', maxLength: STATUS_MESSAGE_MAX_LENGTH },
        removeAvatar: { type: 'boolean' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: MeDto })
  update(
    @CurrentUser() user: User,
    @Body() body: UpdateProfileDto,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<MeDto> {
    return this.profiles.update(user, body, file?.buffer);
  }

  @Get('profiles/:userId')
  @ApiOperation({
    summary: '프로필 보기. 본인·친구·같은 친구가 있는 사람만, 그 밖(차단·탈퇴 포함)은 404',
  })
  @ApiOkResponse({ type: ProfileDto })
  profile(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
  ): Promise<ProfileDto> {
    return this.profiles.profile(user, userId);
  }

  @Get('profiles/:userId/avatar')
  @ApiOperation({ summary: '프로필 사진 파일(JPEG). 볼 수 없는 사람·사진 없음은 404' })
  @ApiQuery({ name: 'size', required: false, enum: ['view', 'thumb'] })
  @ApiProduces('image/jpeg')
  async avatar(
    @CurrentUser() user: User,
    @Param('userId', UuidParamPipe) userId: string,
    @Query('size') size: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const variant = size === 'thumb' ? 'thumb' : 'view';
    const { avatarId, ...opened } = await this.profiles.openAvatar(user, userId, variant);
    return sendPhoto(req, res, avatarId, variant, opened);
  }
}
