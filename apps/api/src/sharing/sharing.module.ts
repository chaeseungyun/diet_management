import { Module } from '@nestjs/common';
import { MealsModule } from '../meals/meals.module';
import { PhotosModule } from '../photos/photos.module';
import { FriendsService } from './friends.service';
import { SharingAccessService } from './sharing-access.service';
import { SharingController } from './sharing.controller';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

/** 끼니 공유 (sharing-plan, DEC-066·090) */
@Module({
  imports: [MealsModule, PhotosModule],
  controllers: [SharingController, SocialController],
  providers: [FriendsService, SharingAccessService, SocialService],
})
export class SharingModule {}
