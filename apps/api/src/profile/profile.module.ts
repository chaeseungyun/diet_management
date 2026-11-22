import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module';
import { SharingModule } from '../sharing/sharing.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/** 프로필: 닉네임·상태 메시지·프로필 사진 (DEC-104) */
@Module({
  imports: [PhotosModule, SharingModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
