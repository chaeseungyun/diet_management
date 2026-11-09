import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { NotificationKind, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import {
  CreatePushSubscriptionDto,
  NOTIFICATION_KINDS,
  NotificationSettingDto,
  PushPublicKeyDto,
  PushSubscriptionDto,
  PutNotificationSettingDto,
  SLOT_KINDS,
} from './notifications.dto';
import { isAllowedPushEndpoint } from './push-endpoint';

/**
 * 알림 설정·푸시 구독 (FR-09, DEC-074, S-71).
 * 설정은 저장만 한다. 언제 보낼지는 발송 시점에 스케줄러가 판정하므로 재예약이 없다.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async settings(user: User): Promise<NotificationSettingDto[]> {
    const rows = await this.prisma.notificationSetting.findMany({ where: { userId: user.id } });
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return NOTIFICATION_KINDS.map((k) => NotificationSettingDto.from(k, byKind.get(k)));
  }

  async putSetting(
    user: User,
    kind: NotificationKind,
    dto: PutNotificationSettingDto,
  ): Promise<NotificationSettingDto> {
    const existing = await this.prisma.notificationSetting.findUnique({
      where: { userId_kind: { userId: user.id, kind } },
    });
    const notifyMinute =
      dto.notifyMinute !== undefined ? dto.notifyMinute : (existing?.notifyMinute ?? null);
    if (SLOT_KINDS.includes(kind) && dto.enabled && notifyMinute === null) {
      throw new UnprocessableEntityException('notifyMinute is required to enable a meal reminder');
    }
    const data = {
      enabled: dto.enabled,
      notifyMinute,
      ...(dto.remindAfterMinutes !== undefined
        ? { remindAfterMinutes: dto.remindAfterMinutes }
        : {}),
      ...(dto.remindMaxCount !== undefined ? { remindMaxCount: dto.remindMaxCount } : {}),
      ...(dto.daysBefore !== undefined ? { daysBefore: dto.daysBefore } : {}),
    };
    const row = await this.prisma.notificationSetting.upsert({
      where: { userId_kind: { userId: user.id, kind } },
      create: { userId: user.id, kind, ...data },
      update: data,
    });
    return NotificationSettingDto.from(kind, row);
  }

  // ---------- 푸시 구독 ----------

  publicKey(): PushPublicKeyDto {
    return { publicKey: this.env.pushEnabled ? this.env.VAPID_PUBLIC_KEY : null };
  }

  /**
   * endpoint 기준 upsert. 같은 기기에서 다른 계정이 등록하면 소유자를 옮긴다
   * (한 기기에는 마지막으로 등록한 계정의 알림만 간다). 해제됐던 구독은 다시 활성으로.
   */
  async subscribe(
    user: User,
    dto: CreatePushSubscriptionDto,
    userAgent: string | undefined,
  ): Promise<PushSubscriptionDto> {
    if (!isAllowedPushEndpoint(dto.endpoint)) {
      throw new UnprocessableEntityException('endpoint is not a known push service');
    }
    const data = {
      userId: user.id,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
      revokedAt: null,
    };
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  /** 이 사용자의 구독이 아니면 존재 여부와 무관하게 404 (D-06) */
  async unsubscribe(user: User, endpoint: string): Promise<void> {
    const { count } = await this.prisma.pushSubscription.updateMany({
      where: { endpoint, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      const owned = await this.prisma.pushSubscription.findFirst({
        where: { endpoint, userId: user.id },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException();
    }
  }
}
