import { Module } from '@nestjs/common';
import { NotificationSettingsController, PushController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** 알림 (단계 2, FR-09, D-22, DEC-074). 발송 스케줄러는 다음 커밋에서 추가한다 */
@Module({
  controllers: [NotificationSettingsController, PushController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
