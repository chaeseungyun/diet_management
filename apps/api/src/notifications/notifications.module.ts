import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { StockModule } from '../stock/stock.module';
import {
  NotificationHistoryController,
  NotificationSettingsController,
  PushController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationScheduler } from './notification-scheduler';
import { PUSH_SENDER, WebPushSender } from './push-sender';

/** 알림 (단계 2, FR-09, D-22, DEC-074·075·084). 발송은 매분 스케줄러가 판정해 보낸다 */
@Module({
  imports: [PlansModule, StockModule],
  controllers: [NotificationSettingsController, PushController, NotificationHistoryController],
  providers: [
    NotificationsService,
    NotificationScheduler,
    { provide: PUSH_SENDER, useClass: WebPushSender },
  ],
  exports: [NotificationsService, NotificationScheduler],
})
export class NotificationsModule {}
