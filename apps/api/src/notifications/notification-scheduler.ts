import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  type MealSlot,
  type NotificationDelivery,
  type NotificationKind,
  type NotificationSetting,
  type NotificationType,
  type User,
} from '@prisma/client';
import { SLOT_LABELS, SUGGESTED_NOTIFY_MINUTES, todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { ENV, type Env } from '../config/env';
import { fromDbDate, toDbDate, type DateString } from '../domain/dates';
import {
  candidateDates,
  dueDayComplete,
  dueMealNotifications,
  GRACE_MS,
  MAX_ATTEMPTS,
  stockAlertScheduledAt,
  type DepletionCandidate,
} from '../domain/notifications';
import { StockService } from '../stock/stock.service';
import { DEFAULT_ENABLED, DEFAULTS, NOTIFICATION_KINDS, SLOT_KINDS } from './notifications.dto';
import { PUSH_SENDER, type PushPayload, type PushSender, type SendResult } from './push-sender';

/** 다른 실행이 막 보내는 중인 행을 다시 집지 않도록 하는 임대 시간 */
const LEASE_MS = 50_000;

/** 보내기로 한 알림 하나. 유니크 (user, type, targetDate, targetKey, seq) 로 선점한다 */
interface Claim {
  type: NotificationType;
  targetDate: DateString;
  targetKey: string;
  slot: MealSlot | null;
  seq: number;
  scheduledAt: Date;
  payload: PushPayload;
  /** 소진 알림 묶음에 든 제품. 발송 기록에 남기고, 나간 뒤 제품에 '알렸음' 을 적는 데 쓴다 (DEC-084) */
  productIds?: string[];
}

/** 하루 완료·소진 알림 묶음의 유니크 키 */
const DAY_KEY = 'day';
const BUNDLE_KEY = 'bundle';

/** 하루 완료 알림: 발송이 실패·만료한 날 다시 시도하는 상한(회차 seq 0~2) */
const DAY_COMPLETE_MAX_TRIES = 3;

export interface TickResult {
  expired: number;
  retried: number;
  claimed: number;
  sent: number;
}

/**
 * 알림 스케줄러 (DEC-074·075·084). 매분 "지금 보낼 알림" 을 판정하고, 행을 유니크 선점한 뒤 보낸다.
 * 종류: 끼니 알림·미기록 재알림, 하루 완료 알림, 소진 알림(하루 한 통 묶음).
 * 중복 방지: 새 알림은 (user, type, target_date, target_key, seq) 유니크, 재시도는 attempts·임대 조건부 갱신.
 * 전달은 '최소 한 번'이다 — 푸시 서비스가 받은 직후 DB 기록 전에 죽으면 한 번 더 갈 수 있고, 같은 tag 라 폰에서는 덮어쓴다.
 */
@Injectable()
export class NotificationScheduler {
  private readonly log = new Logger(NotificationScheduler.name);
  private running = false;
  /**
   * 소진 알림: 사용자별로 '이 알림 시각의 창에서 이미 살펴봤고 보낼 것이 없었다' 를 기억한다.
   * 15분 창 동안 매분 예측을 다시 계산하지 않기 위한 것이고, 재시작하면 한 번 더 계산할 뿐이다.
   */
  private readonly stockChecked = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly stock: StockService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notifications' })
  async onCron(): Promise<void> {
    if (!this.env.notificationsEnabled) return;
    await this.runOnce(new Date());
  }

  /** 테스트용: 같은 알림 시각의 창에서 소진 알림을 다시 살펴보게 한다 */
  forgetStockChecks(): void {
    this.stockChecked.clear();
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

    // 3. 새 알림: 활성 구독이 있는 사용자만. 하루 완료·소진 알림은 설정 행이 없어도 켜진 것으로 본다
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, pushSubscriptions: { some: { revokedAt: null } } },
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
  ): Promise<Claim[]> {
    const dates = candidateDates(now, user.timezone);
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const settings = new Map(user.notificationSettings.map((s) => [s.kind, s]));
    const on = (kind: NotificationKind): boolean =>
      settings.get(kind)?.enabled ?? DEFAULT_ENABLED[kind];
    // 재알림은 끼니 알림에 딸린 것이라 혼자서는 보낼 것이 없다. 전부 꺼져 있으면 조회하지 않는다
    if (!NOTIFICATION_KINDS.some((k) => k !== 'unrecorded_remind' && on(k))) return [];

    const [resolver, records, deliveries, completions] = await Promise.all([
      this.plans.loadResolver(this.prisma, user.id, from, to),
      this.prisma.mealRecord.findMany({
        where: {
          userId: user.id,
          mealDate: { gte: toDbDate(from), lte: toDbDate(to) },
          seq: 0,
          slot: { not: 'extra' },
        },
        select: { mealDate: true, slot: true, status: true, updatedAt: true },
      }),
      this.prisma.notificationDelivery.findMany({
        where: { userId: user.id, targetDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      }),
      this.prisma.dayCompletion.findMany({
        where: { userId: user.id, onDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        select: { onDate: true },
      }),
    ]);
    const recordOf = new Map(records.map((r) => [`${fromDbDate(r.mealDate)}:${r.slot}`, r]));
    const remind = settings.get('unrecorded_remind');

    const due = dueMealNotifications({
      now,
      timezone: user.timezone,
      activeSlots: user.activeSlots,
      slotSettings: SLOT_KINDS.map((k) => ({
        slot: k as MealSlot,
        enabled: on(k),
        notifyMinute: settings.get(k)?.notifyMinute ?? null,
      })),
      remind: {
        enabled: on('unrecorded_remind'),
        afterMinutes: remind?.remindAfterMinutes ?? DEFAULTS.remindAfterMinutes,
        maxCount: remind?.remindMaxCount ?? DEFAULTS.remindMaxCount,
      },
      plan: (date, slot) => resolver.resolve(date, slot),
      status: (date, slot) => recordOf.get(`${date}:${slot}`)?.status ?? null,
      deliveries: deliveries.map((d) => ({
        type: d.type,
        targetDate: fromDbDate(d.targetDate),
        targetKey: d.targetKey,
        seq: d.seq,
        status: d.status,
        sentAt: d.sentAt,
      })),
    });
    const claims: Claim[] = [];
    if (due.length > 0) {
      const ids = [...new Set(due.map((d) => d.templateId).filter((x): x is string => !!x))];
      const templates = await this.prisma.mealTemplate.findMany({
        where: { userId: user.id, id: { in: ids } },
        select: { id: true, name: true },
      });
      const names = new Map(templates.map((t) => [t.id, t.name]));
      for (const d of due) {
        claims.push({
          type: d.type,
          targetDate: d.targetDate,
          targetKey: d.slot,
          slot: d.slot,
          seq: d.seq,
          scheduledAt: d.scheduledAt,
          payload: mealPayload(d, names.get(d.templateId ?? '')),
        });
      }
    }

    // 하루 완료 알림: 식단 끼니를 모두 기록하고 1시간이 지났는데 완료를 누르지 않았을 때 (DEC-084)
    const today = todayIn(user.timezone, now);
    // 발송이 실패·만료한 날은 '보낸 날' 로 세지 않는다. 다만 같은 예약 시각으로는 다시 보내지 않고,
    // 기록을 고쳐 예약 시각이 뒤로 갔을 때만 다음 회차(seq)로 보낸다
    const dayRows = deliveries.filter((d) => d.type === 'day_complete');
    const dayTries = new Map<DateString, number>();
    const dayNotified = new Set<DateString>();
    const dayFailedAt = new Map<DateString, Date>();
    for (const d of dayRows) {
      const date = fromDbDate(d.targetDate);
      const tries = (dayTries.get(date) ?? 0) + 1;
      dayTries.set(date, tries);
      if (d.status === 'sent' || d.status === 'pending' || tries >= DAY_COMPLETE_MAX_TRIES) {
        dayNotified.add(date);
      } else {
        const prev = dayFailedAt.get(date);
        if (!prev || d.scheduledAt > prev) dayFailedAt.set(date, d.scheduledAt);
      }
    }
    // 쓰는 끼니 중 가장 늦은 끼니의 시각: 저장한 알림 시각, 없으면 제안 시각
    const slotMinutes = SLOT_KINDS.filter((k) => (user.activeSlots as string[]).includes(k)).map(
      (k) =>
        settings.get(k)?.notifyMinute ??
        SUGGESTED_NOTIFY_MINUTES[k as keyof typeof SUGGESTED_NOTIFY_MINUTES],
    );
    const dayDue = dueDayComplete({
      now,
      timezone: user.timezone,
      enabled: on('day_complete'),
      lastSlotMinute: slotMinutes.length > 0 ? Math.max(...slotMinutes) : null,
      signupDate: todayIn(user.timezone, user.createdAt),
      activeSlots: user.activeSlots,
      plan: (date, slot) => resolver.resolve(date, slot),
      record: (date, slot) => recordOf.get(`${date}:${slot}`) ?? null,
      completed: new Set(completions.map((c) => fromDbDate(c.onDate))),
      notified: dayNotified,
      failedAt: dayFailedAt,
    });
    for (const d of dayDue) {
      claims.push({
        type: 'day_complete',
        targetDate: d.targetDate,
        targetKey: DAY_KEY,
        slot: null,
        seq: dayTries.get(d.targetDate) ?? 0,
        scheduledAt: d.scheduledAt,
        payload: dayCompletePayload(d.targetDate, today),
      });
    }

    const alreadyToday = deliveries.some(
      (d) => d.type === 'stock_depletion' && fromDbDate(d.targetDate) === today,
    );
    // 소진 판정(예측 계산)이 실패해도 위에서 고른 끼니·하루 완료 알림은 보낸다
    let stockClaim: Claim | null = null;
    if (!alreadyToday) {
      try {
        stockClaim = await this.stockDue(
          user,
          now,
          today,
          on('stock_depletion'),
          settings.get('stock_depletion'),
        );
      } catch (e) {
        this.log.error(
          `user ${user.id} stock alert: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (stockClaim) claims.push(stockClaim);
    return claims;
  }

  /**
   * 소진 알림 (DEC-084). 알림 시각(기본 09:00)부터 15분 안에, 소진 임박이면서 배송 중이 아니고
   * 아직 알리지 않은 식품을 하루 한 통으로 묶는다. 없으면 행을 만들지 않는다.
   * '알렸음' 은 제품의 depletion_alerted_at 이다: 보낸 뒤에 적고, 임박에서 벗어난 것을 여기서 지운다.
   */
  private async stockDue(
    user: User,
    now: Date,
    today: DateString,
    enabled: boolean,
    setting: NotificationSetting | undefined,
  ): Promise<Claim | null> {
    if (!enabled) return null;
    const scheduledAt = stockAlertScheduledAt(now, user.timezone, setting?.notifyMinute ?? null);
    if (!scheduledAt) return null;
    if (this.stockChecked.get(user.id) === scheduledAt.getTime()) return null;

    const fresh = await this.stock.depletionAlerts(user, now);
    if (fresh.length === 0) {
      this.stockChecked.set(user.id, scheduledAt.getTime());
      return null;
    }
    return {
      type: 'stock_depletion',
      targetDate: today,
      targetKey: BUNDLE_KEY,
      slot: null,
      seq: 0,
      scheduledAt,
      payload: stockPayload(fresh, today),
      productIds: fresh.map((c) => c.productId),
    };
  }

  /** 행을 먼저 만든다. 유니크 충돌이면 다른 실행이 이미 처리한 것 → null */
  private async claim(userId: string, d: Claim, now: Date): Promise<NotificationDelivery | null> {
    try {
      return await this.prisma.notificationDelivery.create({
        data: {
          userId,
          type: d.type,
          targetDate: toDbDate(d.targetDate),
          targetKey: d.targetKey,
          seq: d.seq,
          slot: d.slot,
          scheduledAt: d.scheduledAt,
          status: 'pending',
          attempts: 1,
          lastAttemptAt: now,
          payload: {
            ...d.payload,
            ...(d.productIds ? { productIds: d.productIds } : {}),
          } as unknown as Prisma.InputJsonValue,
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
    // 저장된 본문에는 productIds 같은 기록용 값이 섞여 있어 푸시에 실을 것만 고른다
    const stored = row.payload as unknown as PushPayload | null;
    const payload: PushPayload | null = stored
      ? { title: stored.title, body: stored.body, url: stored.url, tag: stored.tag }
      : null;
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
      // 소진 알림은 실제로 나간 뒤에 '알렸음' 을 적는다. 실패한 날은 다음 날 다시 대상이 된다
      const productIds = (row.payload as { productIds?: unknown } | null)?.productIds;
      if (row.type === 'stock_depletion' && Array.isArray(productIds)) {
        await this.prisma.product.updateMany({
          where: {
            userId: row.userId,
            id: { in: productIds.filter((x): x is string => typeof x === 'string') },
          },
          data: { depletionAlertedAt: now },
        });
      }
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

/** 하루 완료 알림 문구 (DEC-084). 누르면 그 날짜 화면의 하루 완료 버튼으로 간다 */
export function dayCompletePayload(date: DateString, today: DateString): PushPayload {
  return {
    title: `${date === today ? '오늘' : '어제'} 끼니를 모두 기록했어요`,
    body: '하루 완료를 눌러 마무리해 주세요',
    url: `/day/${date}`,
    tag: `day-complete-${date}`,
  };
}

/** 소진 알림 문구 (DEC-084). 하나면 그 식품 상세, 여러 개면 식품 목록으로 간다 */
export function stockPayload(items: readonly DepletionCandidate[], date: DateString): PushPayload {
  const first = items[0]!;
  if (items.length === 1) {
    const [, m, d] = first.depletionDate.split('-').map(Number);
    const when =
      first.daysLeft === 0 ? '오늘' : first.daysLeft === 1 ? '내일' : `${first.daysLeft}일 뒤`;
    return {
      title: `${first.name} 곧 떨어져요`,
      body: `${m}월 ${d}일(${when})에 떨어져요 · 눌러서 확인하기`,
      url: `/products/${first.productId}`,
      tag: `stock-${date}`,
    };
  }
  const names = items.slice(0, 3).map((i) => i.name);
  return {
    title: `${first.name} 외 ${items.length - 1}개가 곧 떨어져요`,
    body: `${names.join(', ')}${items.length > 3 ? ' 등' : ''} · 눌러서 확인하기`,
    url: '/products',
    tag: `stock-${date}`,
  };
}
