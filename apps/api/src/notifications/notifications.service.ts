import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppException, unprocessable } from '../common/errors';
import { SUGGESTED_NOTIFY_MINUTES, todayIn, type MealSlot } from '@diet/shared';
import type { NotificationKind, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import { addDays, toDbDate } from '../domain/dates';
import { assertRange } from '../common/validators';
import { NotificationScheduler } from './notification-scheduler';
import {
  CreatePushSubscriptionDto,
  EnableMealsResultDto,
  NOTIFICATION_KINDS,
  NotificationDeliveryDto,
  NotificationSettingDto,
  PushPublicKeyDto,
  PushSubscriptionDto,
  PutNotificationSettingDto,
  SLOT_KINDS,
  TestPushResultDto,
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
    private readonly scheduler: NotificationScheduler,
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
      throw unprocessable(
        'NOTIFY_TIME_REQUIRED',
        'notifyMinute is required to enable a meal reminder',
      );
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

  /**
   * '알림 켜기' 직후 (DEC-077). 켜진 끼니 알림이 하나도 없을 때만 쓰는 끼니(D-18)를 모두 켠다.
   * 시각이 이미 있으면 그 시각, 없으면 제안 시각. 하나라도 켜져 있으면 사용자가 고른 것이라 건드리지 않는다.
   * 재알림은 바꾸지 않는다. 하루 완료·소진 알림은 행이 없어도 켜진 것으로 본다(DEC-084). 두 번 불러도 결과가 같다.
   */
  async enableMeals(user: User): Promise<EnableMealsResultDto> {
    const rows = await this.prisma.notificationSetting.findMany({ where: { userId: user.id } });
    const anyOn = rows.some((r) => r.enabled && SLOT_KINDS.includes(r.kind));
    const kinds = anyOn ? [] : SLOT_KINDS.filter((k) => (user.activeSlots as string[]).includes(k));
    for (const kind of kinds) {
      const notifyMinute =
        rows.find((r) => r.kind === kind)?.notifyMinute ??
        SUGGESTED_NOTIFY_MINUTES[kind as MealSlot];
      await this.prisma.notificationSetting.upsert({
        where: { userId_kind: { userId: user.id, kind } },
        create: { userId: user.id, kind, enabled: true, notifyMinute },
        update: { enabled: true, notifyMinute },
      });
    }
    return { applied: kinds.length > 0, enabledKinds: kinds, settings: await this.settings(user) };
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
      throw unprocessable('PUSH_ENDPOINT_INVALID', 'endpoint is not a known push service');
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

  /**
   * 이 기기에만 테스트 알림을 보낸다(DEC-074). 발송 기록에는 남기지 않는다.
   * 서버에 VAPID 키가 없으면 503, 내 활성 구독이 아니면 404.
   */
  async testPush(user: User, endpoint: string): Promise<TestPushResultDto> {
    if (!this.env.pushEnabled) {
      throw new AppException(503, 'PUSH_NOT_CONFIGURED', 'push is not configured');
    }
    const sub = await this.prisma.pushSubscription.findFirst({
      where: { endpoint, userId: user.id, revokedAt: null },
    });
    if (!sub) throw new NotFoundException();
    const r = await this.scheduler.sendOne(
      sub,
      {
        title: '테스트 알림',
        body: '이 기기에서 알림을 받을 수 있습니다.',
        url: '/settings/notifications',
        tag: 'test',
      },
      new Date(),
    );
    if (r.kind === 'ok') return { ok: true, status: r.status, reason: null };
    if (r.kind === 'gone') {
      return {
        ok: false,
        status: r.status,
        reason: '구독이 만료되었습니다. 알림을 다시 켜 주세요.',
      };
    }
    return { ok: false, status: r.status, reason: r.reason || r.kind };
  }

  /** 발송 기록. 기본 최근 7일, 최대 31일 */
  async deliveries(user: User, from?: string, to?: string): Promise<NotificationDeliveryDto[]> {
    const end = to ?? todayIn(user.timezone);
    const start = from ?? addDays(end, -6);
    assertRange(start, end, 31);
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { userId: user.id, targetDate: { gte: toDbDate(start), lte: toDbDate(end) } },
      orderBy: { scheduledAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => NotificationDeliveryDto.from(r));
  }
}
