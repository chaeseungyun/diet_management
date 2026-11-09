import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  PipeTransform,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationKind, type User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import {
  CreatePushSubscriptionDto,
  NOTIFICATION_KINDS,
  NotificationSettingDto,
  PushPublicKeyDto,
  PushSubscriptionDto,
  PutNotificationSettingDto,
  UnsubscribeDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/** 모르는 종류는 존재할 수 없는 리소스라 404 (SlotParamPipe 와 같은 규칙) */
@Injectable()
class KindParamPipe implements PipeTransform<string, NotificationKind> {
  transform(value: string): NotificationKind {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(value)) throw new NotFoundException();
    return value as NotificationKind;
  }
}

/** 알림 설정 (api.md §11, FR-09, S-71) */
@ApiTags('notifications')
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: '알림 설정 7종(5끼니·미기록 재알림·소진). 행이 없으면 기본값(꺼짐)' })
  @ApiOkResponse({ type: NotificationSettingDto, isArray: true })
  list(@CurrentUser() user: User): Promise<NotificationSettingDto[]> {
    return this.notifications.settings(user);
  }

  @Put(':kind')
  @ApiOperation({
    summary: '종류별 설정 저장. 끼니 알림을 켜려면 notifyMinute 필요. 재예약 없음(DEC-074)',
  })
  @ApiParam({ name: 'kind', enum: NotificationKind, enumName: 'NotificationKind' })
  @ApiOkResponse({ type: NotificationSettingDto })
  put(
    @CurrentUser() user: User,
    @Param('kind', KindParamPipe) kind: NotificationKind,
    @Body() body: PutNotificationSettingDto,
  ): Promise<NotificationSettingDto> {
    return this.notifications.putSetting(user, kind, body);
  }
}

/** 웹 푸시 구독 (api.md §11, DEC-072·074) */
@ApiTags('notifications')
@Controller('push')
export class PushController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('public-key')
  @ApiOperation({ summary: 'VAPID 공개키. 서버에 키가 없으면 null' })
  @ApiOkResponse({ type: PushPublicKeyDto })
  publicKey(): PushPublicKeyDto {
    return this.notifications.publicKey();
  }

  @Post('subscriptions')
  @HttpCode(200)
  @ApiOperation({
    summary: '현재 기기 구독 등록(endpoint 기준 upsert). 알려진 푸시 서비스 주소만 받는다',
  })
  @ApiOkResponse({ type: PushSubscriptionDto })
  subscribe(
    @CurrentUser() user: User,
    @Body() body: CreatePushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PushSubscriptionDto> {
    return this.notifications.subscribe(user, body, userAgent);
  }

  @Post('subscriptions/unsubscribe')
  @HttpCode(204)
  @ApiOperation({ summary: 'endpoint 로 구독 해제(로그아웃 시). 내 구독이 아니면 404' })
  @ApiNoContentResponse()
  unsubscribe(@CurrentUser() user: User, @Body() body: UnsubscribeDto): Promise<void> {
    return this.notifications.unsubscribe(user, body.endpoint);
  }
}
