/**
 * 알림 판정·발송 (FR-09, DEC-074·075, state-transitions §5, 시나리오 8).
 * 가짜 발송기로 web-push 를 대신하고, 스케줄러 tick 에 시각을 넣어 직접 돌린다.
 */
import { createECDH } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { isoWeekday, toDbDate } from '../src/domain/dates';
import { NotificationScheduler } from '../src/notifications/notification-scheduler';
import type {
  PushPayload,
  PushSender,
  PushTarget,
  SendResult,
} from '../src/notifications/push-sender';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const WEEKDAY = isoWeekday(TODAY);
const at = (hhmm: string): Date => new Date(`${TODAY}T${hhmm}:00+09:00`);

const EP_A = 'https://fcm.googleapis.com/fcm/send/device-a';
const EP_B = 'https://fcm.googleapis.com/fcm/send/device-b';
const KEYS = {
  p256dh: 'BOr5x2bD0z7xXq9vY1kq0y6sQ0b0lQe2c4c1s3m5n7p9r1t3v5x7',
  auth: 'k3Jz8wQ1u5Yt2Pq9Lm4NcA',
};

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const VAPID = {
  VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
  VAPID_SUBJECT: 'mailto:ops@example.com',
};

class FakeSender implements PushSender {
  calls: { endpoint: string; payload: PushPayload }[] = [];
  /** 다음 호출들의 결과. 비면 성공 */
  queue: SendResult[] = [];
  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    this.calls.push({ endpoint: target.endpoint, payload });
    return this.queue.shift() ?? { kind: 'ok', status: 201 };
  }
}

describe('phase 2: notification delivery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let scheduler: NotificationScheduler;
  const fake = new FakeSender();

  const deliveries = (slot: string) =>
    prisma.notificationDelivery.findMany({
      where: { targetDate: toDbDate(TODAY), targetKey: slot },
      orderBy: { seq: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createApp({ env: VAPID, pushSender: fake }));
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    server = app.getHttpServer();
    scheduler = app.get(NotificationScheduler);
    a = api(server, await login(server, 'deliver-a', 'A'));
    b = api(server, await login(server, 'deliver-b', 'B'));

    const product = (
      await a
        .post('/products')
        .send({ name: '닭가슴살', stockUnit: 'g', unitsPerPackage: 1000 })
        .expect(201)
    ).body.id;
    const template = (
      await a
        .post('/meal-templates')
        .send({ name: '닭 200', items: [{ productId: product, quantity: 200, unit: 'g' }] })
        .expect(201)
    ).body.id;
    // 오늘 요일: 아침은 자유 끼니, 나머지 4끼는 식단
    for (const slot of ['lunch', 'afternoon_snack', 'dinner', 'evening_snack']) {
      await a
        .put(`/plans/weekly/${WEEKDAY}/${slot}`)
        .send({ planType: 'template', templateId: template })
        .expect(200);
    }
    const times: Record<string, number> = {
      breakfast: 8 * 60,
      lunch: 12 * 60,
      afternoon_snack: 15 * 60,
      dinner: 18 * 60,
      evening_snack: 21 * 60,
    };
    for (const [kind, notifyMinute] of Object.entries(times)) {
      await a
        .put(`/notification-settings/${kind}`)
        .send({ enabled: true, notifyMinute })
        .expect(200);
    }
    await a
      .put('/notification-settings/unrecorded_remind')
      .send({ enabled: true, remindAfterMinutes: 60, remindMaxCount: 1 })
      .expect(200);
    await a.post('/push/subscriptions').send({ endpoint: EP_A, keys: KEYS }).expect(200);
    await b.post('/push/subscriptions').send({ endpoint: EP_B, keys: KEYS }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fake.calls = [];
    fake.queue = [];
  });

  it('does not notify a free slot (D-19) or before the set time', async () => {
    expect(await scheduler.tick(at('08:00'))).toMatchObject({ claimed: 0 });
    expect(await scheduler.tick(at('11:59'))).toMatchObject({ claimed: 0 });
    expect(fake.calls).toHaveLength(0);
  });

  it('sends the meal reminder once at the set time', async () => {
    expect(await scheduler.tick(at('12:00'))).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.calls).toEqual([
      {
        endpoint: EP_A,
        payload: {
          title: '점심 기록할 시간이에요',
          body: '닭 200 · 눌러서 기록하기',
          url: `/day/${TODAY}/lunch`,
          tag: `meal-${TODAY}-lunch`,
        },
      },
    ]);
    // 같은 창 안에서 다시 돌아도 한 번뿐
    expect(await scheduler.tick(at('12:05'))).toMatchObject({ claimed: 0 });
    const rows = await deliveries('lunch');
    expect(rows).toMatchObject([{ type: 'meal_check', seq: 0, status: 'sent', attempts: 1 }]);
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: EP_A } }))
        .lastSuccessAt,
    ).not.toBeNull();
  });

  it('sends the unrecorded reminder after the interval, up to the max count', async () => {
    expect(await scheduler.tick(at('12:59'))).toMatchObject({ claimed: 0 });
    expect(await scheduler.tick(at('13:00'))).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.calls[0]!.payload.title).toBe('점심 아직 기록 전이에요');
    expect(fake.calls[0]!.payload.tag).toBe(`meal-${TODAY}-lunch`);
    expect(await scheduler.tick(at('14:00'))).toMatchObject({ claimed: 0 });
    expect((await deliveries('lunch')).map((d) => [d.type, d.seq])).toEqual([
      ['meal_check', 0],
      ['unrecorded_remind', 1],
    ]);
  });

  it('two runs at the same moment send only once (unique claim)', async () => {
    const [r1, r2] = await Promise.all([scheduler.tick(at('18:00')), scheduler.tick(at('18:00'))]);
    expect(r1.claimed + r2.claimed).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(await deliveries('dinner')).toHaveLength(1);
  });

  it('stops reminding once the meal is recorded (D-04)', async () => {
    await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send({ status: 'skipped', version: null })
      .expect(200);
    expect(await scheduler.tick(at('19:00'))).toMatchObject({ claimed: 0 });
    expect(fake.calls).toHaveLength(0);
  });

  it('retries a transient failure after the lease, then succeeds', async () => {
    fake.queue = [{ kind: 'transient', status: 500, reason: 'server error' }];
    expect(await scheduler.tick(at('15:00'))).toMatchObject({ claimed: 1, sent: 0 });
    expect(await deliveries('afternoon_snack')).toMatchObject([
      { status: 'pending', attempts: 1, failureReason: 'transient 500: server error' },
    ]);
    // 임대(50초) 안에서는 다시 집지 않는다
    expect(await scheduler.tick(new Date(at('15:00').getTime() + 30_000))).toMatchObject({
      retried: 0,
    });
    expect(await scheduler.tick(at('15:01'))).toMatchObject({ retried: 1, sent: 1 });
    expect(await deliveries('afternoon_snack')).toMatchObject([{ status: 'sent', attempts: 2 }]);
    expect(fake.calls).toHaveLength(2);
  });

  it('revokes a gone subscription (410) and records the failure', async () => {
    fake.queue = [{ kind: 'gone', status: 410 }];
    expect(await scheduler.tick(at('21:00'))).toMatchObject({ claimed: 1, sent: 0 });
    expect(await deliveries('evening_snack')).toMatchObject([
      { status: 'failed', failureReason: 'gone 410' },
    ]);
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: EP_A } })).revokedAt,
    ).not.toBeNull();
    // 활성 구독이 없으면 대상에서 빠진다
    expect(await scheduler.tick(at('21:05'))).toMatchObject({ claimed: 0 });
    await a.post('/push/subscriptions').send({ endpoint: EP_A, keys: KEYS }).expect(200);
  });

  it('expires a claimed but unsent row after the 15 minute grace', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { kakaoId: 'deliver-a' } });
    await prisma.notificationDelivery.create({
      data: {
        userId: user.id,
        type: 'meal_check',
        targetDate: toDbDate(TODAY),
        targetKey: 'breakfast',
        slot: 'breakfast',
        scheduledAt: at('05:00'),
        status: 'pending',
        attempts: 1,
        lastAttemptAt: at('05:00'),
        payload: { title: 'x' },
      },
    });
    expect(await scheduler.tick(at('06:00'))).toMatchObject({ expired: 1 });
    expect(await deliveries('breakfast')).toMatchObject([
      { status: 'skipped', failureReason: 'expired' },
    ]);
    expect(fake.calls).toHaveLength(0);
  });

  it('lists the delivery history for the owner only', async () => {
    const mine = await a.get('/notifications').expect(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(5);
    expect(mine.body[0]).toHaveProperty('status');
    await b.get('/notifications').expect(200, []);
    await a.get('/notifications?from=2026-01-01&to=2026-03-01').expect(422);
  });

  it('sends a test push to this device only', async () => {
    const res = await a.post('/push/test').send({ endpoint: EP_A }).expect(200);
    expect(res.body).toEqual({ ok: true, status: 201, reason: null });
    expect(fake.calls).toMatchObject([{ endpoint: EP_A, payload: { tag: 'test' } }]);
    await a.post('/push/test').send({ endpoint: EP_B }).expect(404);

    fake.queue = [{ kind: 'gone', status: 410 }];
    const gone = await b.post('/push/test').send({ endpoint: EP_B }).expect(200);
    expect(gone.body).toMatchObject({ ok: false, status: 410 });
    await b.post('/push/test').send({ endpoint: EP_B }).expect(404); // 이제 해제됨
  });

  it('daily cleanup removes expired idempotency keys and old deliveries', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { kakaoId: 'deliver-a' } });
    const now = at('04:00');
    await prisma.idempotencyKey.create({
      data: {
        userId: user.id,
        key: 'old',
        requestHash: 'h',
        expiresAt: new Date(now.getTime() - 1),
      },
    });
    await prisma.notificationDelivery.create({
      data: {
        userId: user.id,
        type: 'meal_check',
        targetDate: toDbDate('2026-01-01'),
        targetKey: 'lunch',
        scheduledAt: new Date('2026-01-01T03:00:00Z'),
        status: 'sent',
        createdAt: new Date(now.getTime() - 91 * 86_400_000),
      },
    });
    const r = await app.get(MaintenanceService).cleanup(now);
    expect(r.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(r.deliveries).toBe(1);
    expect(await prisma.idempotencyKey.count({ where: { key: 'old' } })).toBe(0);
    // 두 번 돌려도 같은 결과
    expect(await app.get(MaintenanceService).cleanup(now)).toMatchObject({ deliveries: 0 });
  });
});

describe('phase 2: test push without VAPID keys', () => {
  it('returns 503 when push is not configured', async () => {
    const { app } = await createApp();
    try {
      const server = app.getHttpServer();
      const c = api(server, await login(server, 'deliver-c', 'C'));
      await c
        .post('/push/subscriptions')
        .send({ endpoint: EP_A + '-c', keys: KEYS })
        .expect(200);
      await c
        .post('/push/test')
        .send({ endpoint: EP_A + '-c' })
        .expect(503);
    } finally {
      await app.close();
    }
  });
});
