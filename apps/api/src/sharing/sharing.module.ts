import { Module } from '@nestjs/common';
import { MealsModule } from '../meals/meals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PhotosModule } from '../photos/photos.module';
import { FriendsService } from './friends.service';
import { SharingAccessService } from './sharing-access.service';
import { SharingController } from './sharing.controller';
import { SocialController } from './social.controller';
import { SocialNotifyService } from './social-notify.service';
import { SocialService } from './social.service';

/** 끼니 공유 (sharing-plan, DEC-066·090) */
@Module({
  imports: [MealsModule, PhotosModule, NotificationsModule],
  controllers: [SharingController, SocialController],
  providers: [FriendsService, SharingAccessService, SocialService, SocialNotifyService],
  // 프로필 보기(DEC-104)가 같은 접근 판정을 쓴다
  exports: [SharingAccessService],
})
export class SharingModule {}
