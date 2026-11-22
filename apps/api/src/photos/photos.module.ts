import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller';
import { AvatarsService } from './avatars.service';
import { PhotosService } from './photos.service';

/** 식사 사진 업로드·보관 (EXT-02a, DEC-069·086) */
@Module({
  controllers: [PhotosController],
  providers: [PhotosService, AvatarsService],
  exports: [PhotosService, AvatarsService],
})
export class PhotosModule {}
