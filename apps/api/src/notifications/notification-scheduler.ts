import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type MealSlot, type NotificationDelivery } from '@prisma/client';
import { SLOT_LABELS } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { ENV, type Env } from '../config/env';
import { fromDbDate, toDbDate, type DateString } from '../domain/dates';
import {
  candidateDates,
  dueMealNotifications,
  GRACE_MS,
  MAX_ATTEMPTS,
  type DueNotification,
} from '../domain/notifications';
import { DEFAULTS, SLOT_KINDS } from './notifications.dto';
import { PUSH_SENDER, type PushPayload, type PushSender, type SendResult } from './push-sender';

/** 다른 실행이 막 보내는 중인 행을 다시 집지 않도록 하는 임대 시간 */
const LEASE_MS = 50_000;

export interface TickResult {
  expired: number;
  retried: number;
  claimed: number;
  sent: number;
}

/**
 * 알림 스케줄러 (DEC-074·075). 매분 "지금 보낼 알림" 을 판정하고, 행을 유니크 선점한 뒤 보낸다.
 * 중복 방지: 새 알림은 (user, type, target_date, target_key, seq) 유니크, 재시도는 attempts·임대 조건부 갱신.
 * 전달은 '최소 한 번'이다 — 푸시 서비스가 받은 직후 DB 기록 전에 죽으면 한 번 더 갈 수 있고, 같은 tag 라 폰에서는 덮어쓴다.
 */
@Injectable()
export class NotificationScheduler {
  private readonly log = new Logger(NotificationScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notifications' })
  async onCron(): Promise<void> {
    if (!this.env.notificationsEnabled) return;
    await this.runOnce(new Date());
  }

  /** 이전 실행이 끝나지 않았으면 건너뛴다 */
  async runOnce(now: Date): Promise<TickResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await this.tick(now);
      if (result.claimed || result.retried || result.expired) {
        this.log.log(
          `tick claimed=${result.claimed} sent=${result.sent} retried=${result.retried} expired=${result.expired}`,
        );
      }
      return result;
    } catch (e) {
      this.log.error(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** 실행 한 번. 테스트는 동시 실행을 확인하려고 이것을 직접 부른다 */
  async tick(now: Date): Promise<TickResult> {
    const result: TickResult = { expired: 0, retried: 0, claimed: 0, sent: 0 };
    const windowStart = new Date(now.getTime() - GRACE_MS);

    // 1. 유예를 넘긴 미발송 행은 만료 (선점한 것만, DEC-075)
    const expired = await this.prisma.notificationDelivery.updateMany({
      where: { status: 'pending', scheduledAt: { lt: windowStart } },
      data: { status: 'skipped', failureReason: 'expired' },
    });
    result.expired = expired.count;

    // 2. 일시 실패로 남은 행 재시도
    const retry = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'pending',
        scheduledAt: { gte: windowStart, lte: now },
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          { lastAttemptAt: null },
          { lastAttemptAt: { lt: new Date(now.getTime() - LEASE_MS) } },
        ],
      },
    });
    for (const row of retry) {
      const leased = await this.prisma.notificationDelivery.updateMany({
        where: { id: row.id, status: 'pending', attempts: row.attempts },
        data: { attempts: row.attempts + 1, lastAttemptAt: now },
      });
      if (leased.count !== 1) continue;
      result.retried++;
      if (await this.dispatch({ ...row, attempts: row.attempts + 1 }, now)) result.sent++;
    }

    // 3. 새 알림: 켜진 끼니 알림과 활성 구독이 있는 사용자만
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        notificationSettings: { some: { enabled: true, kind: { in: [...SLOT_KINDS] } } },
        pushSubscriptions: { some: { revokedAt: null } },
      },
      include: { notificationSettings: true },
    });
    for (const user of users) {
      try {
        const due = await this.dueFor(user, now);
        for (const d of due) {
          const row = await this.claim(user.id, d, now);
          if (!row) continue;
          result.claimed++;
          if (await this.dispatch(row, now)) result.sent++;
        }
      } catch (e) {
        // 한 사용자의 오류가 다른 사용자 발송을 막지 않게
        this.log.error(`user ${user.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  }

  private async dueFor(
    user: Prisma.UserGetPayload<{ include: { notificationSettings: true } }>,
    now: Date,
  ): Promise<(DueNotification & { payload: PushPayload })[]> {
    const dates = candidateDates(now, user.timezone);
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const [resolver, records, deliveries] = await Promise.all([
      this.plans.loadResolver(this.prisma, user.id, from, to),
      this.prisma.mealRecord.findMany({
        where: {
          userId: user.id,
          mealDate: { gte: toDbDate(from), lte: toDbDate(to) },
          seq: 0,
          slot: { not: 'extra' },
        },
        select: { mealDate: true, slot: true, status: true },
      }),
      this.prisma.notificationDelivery.findMany({
        where: {
          userId: user.id,
          targetDate: { gte: toDbDate(from), lte: toDbDate(to) },
          type: { in: ['meal_check', 'unrecorded_remind'] },
        },
      }),
    ]);
    const status = new Map(records.map((r) => [`${fromDbDate(r.mealDate)}:${r.slot}`, r.status]));
    const settings = new Map(user.notificationSettings.map((s) => [s.kind, s]));
    const remind = settings.get('unrecorded_remind');

    const due = dueMealNotifications({
      now,
      timezone: user.timezone,
      activeSlots: user.activeSlots,
      slotSettings: SLOT_KINDS.map((k) => ({
        slot: k as MealSlot,
        enabled: settings.get(k)?.enabled ?? false,
        notifyMinute: settings.get(k)?.notifyMinute ?? null,
      })),
      remind: {
        enabled: remind?.enabled ?? false,
        afterMinutes: remind?.remindAfterMinutes ?? DEFAULTS.remindAfterMinutes,
        maxCount: remind?.remindMaxCount ?? DEFAULTS.remindMaxCount,
      },
      plan: (date, slot) => resolver.resolve(date, slot),
      status: (date, slot) => status.get(`${date}:${slot}`) ?? null,
      deliveries: deliveries.map((d) => ({
        type: d.type,
        targetDate: fromDbDate(d.targetDate),
        targetKey: d.targetKey,
        seq: d.seq,
        status: d.status,
        sentAt: d.sentAt,
      })),
    });
    if (due.length === 0) return [];

    const ids = [...new Set(due.map((d) => d.templateId).filter((x): x is string => !!x))];
    const templates = await this.prisma.mealTemplate.findMany({
      where: { userId: user.id, id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(templates.map((t) => [t.id, t.name]));
    return due.map((d) => ({ ...d, payload: mealPayload(d, names.get(d.templateId ?? '')) }));
  }

  /** 행을 먼저 만든다. 유니크 충돌이면 다른 실행이 이미 처리한 것 → null */
  private async claim(
    userId: string,
    d: DueNotification & { payload: PushPayload },
    now: Date,
  ): Promise<NotificationDelivery | null> {
    try {
      return await this.prisma.notificationDelivery.create({
        data: {
          userId,
          type: d.type,
          targetDate: toDbDate(d.targetDate),
          targetKey: d.slot,
          seq: d.seq,
          slot: d.slot,
          scheduledAt: d.scheduledAt,
          status: 'pending',
          attempts: 1,
          lastAttemptAt: now,
          payload: d.payload as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  /**
   * 그 사용자의 모든 활성 구독에 보낸다. 한 기기라도 성공하면 sent.
   * 일시 실패만 있고 시도가 남았으면 pending 으로 두어 다음 실행이 다시 보낸다.
   */
  private async dispatch(row: NotificationDelivery, now: Date): Promise<boolean> {
    const payload = row.payload as unknown as PushPayload | null;
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId: row.userId, revokedAt: null },
    });
    if (!payload || subs.length === 0) {
      await this.finish(row.id, 'failed', null, payload ? 'no_subscription' : 'no_payload');
      return false;
    }
    const results = await Promise.all(subs.map((s) => this.sendOne(s, payload, now)));
    if (results.some((r) => r.kind === 'ok')) {
      await this.finish(row.id, 'sent', now, null);
      return true;
    }
    const transient = results.find((r) => r.kind === 'transient');
    if (transient && row.attempts < MAX_ATTEMPTS) {
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { failureReason: reasonOf(transient) },
      });
      return false;
    }
    const worst = transient ?? results.find((r) => r.kind === 'permanent') ?? results[0]!;
    await this.finish(row.id, 'failed', null, reasonOf(worst));
    return false;
  }

  /** 기기 하나에 보내고 구독 상태를 갱신한다. 테스트 발송(POST /push/test)도 쓴다 */
  async sendOne(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
    now: Date,
  ): Promise<SendResult> {
    const r = await this.sender.send(sub, payload);
    if (r.kind === 'ok') {
      await this.prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { lastSuccessAt: now },
      });
    } else if (r.kind === 'gone') {
      await this.prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { revokedAt: now },
      });
    }
    return r;
  }

  private async finish(
    id: string,
    status: 'sent' | 'failed',
    sentAt: Date | null,
    failureReason: string | null,
  ): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { status, sentAt, failureReason },
    });
  }
}

function reasonOf(r: SendResult): string {
  if (r.kind === 'gone') return `gone ${r.status}`;
  if (r.kind === 'ok') return 'ok';
  return `${r.kind}${r.status !== null ? ` ${r.status}` : ''}: ${r.reason}`.slice(0, 300);
}

/** 알림 문구. 재알림은 같은 tag 로 앞 알림을 덮어쓴다 */
export function mealPayload(
  d: { type: 'meal_check' | 'unrecorded_remind'; targetDate: DateString; slot: MealSlot },
  templateName: string | undefined,
): PushPayload {
  const label = SLOT_LABELS[d.slot];
  return {
    title: d.type === 'meal_check' ? `${label} 기록할 시간이에요` : `${label} 아직 기록 전이에요`,
    body: `${templateName ?? '오늘 식단'} · 눌러서 기록하기`,
    url: `/day/${d.targetDate}/${d.slot}`,
    tag: `meal-${d.targetDate}-${d.slot}`,
  };
}
