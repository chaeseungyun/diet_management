import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { PHOTO_MAX_UPLOAD_BYTES } from '@diet/shared';
import { CurrentUser } from '../auth/auth.guard';
import { OptionalUuidPipe, UuidParamPipe } from '../common/validators';
import { MealPhotoDto } from './photos.dto';
import { PhotosService } from './photos.service';

/** 식사 사진 (EXT-02a, DEC-069·086). 파일 응답은 접근 판정 뒤 API 가 직접 흘려보낸다(서명 URL 없음) */
@ApiTags('meal-photos')
@Controller('meal-photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post()
  @HttpCode(201)
  // 저장소 옵션을 주지 않으면 메모리에 받는다 → 원본이 디스크에 남지 않는다
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_UPLOAD_BYTES, files: 1 } }),
  )
  @ApiOperation({
    summary:
      '사진 올리기(JPEG·PNG·WebP, 10 MB 초과는 413). mealRecordId 가 없으면 임시 사진이며 기록 저장의 photoIds 로 붙인다',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        mealRecordId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: MealPhotoDto })
  upload(
    @CurrentUser() user: User,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body('mealRecordId', OptionalUuidPipe) mealRecordId?: string,
  ): Promise<MealPhotoDto> {
    return this.photos.upload(user, file?.buffer, mealRecordId);
  }

  @Get(':id')
  @ApiOperation({ summary: '사진 파일(JPEG). 타인·삭제·보관 기간 지남은 404' })
  @ApiQuery({ name: 'size', required: false, enum: ['view', 'thumb'] })
  @ApiProduces('image/jpeg')
  async file(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Query('size') size: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const variant = size === 'thumb' ? 'thumb' : 'view';
    const { stream, length } = await this.photos.open(user, id, variant);
    // 내용은 바뀌지 않지만 삭제·만료·로그아웃 뒤에는 보이면 안 된다.
    // 그래서 매번 서버에 묻게 하고(no-cache), 그대로면 본문 없이 304 로 답한다
    const etag = `"${id}-${variant}"`;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      stream.destroy();
      res.status(304);
      return undefined;
    }
    return new StreamableFile(stream, { type: 'image/jpeg', length });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '사진 삭제. 기록의 version·하루 완료는 바뀌지 않는다' })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    return this.photos.remove(user, id);
  }
}
