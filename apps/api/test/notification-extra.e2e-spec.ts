/**
 * 하루 완료 알림·소진 알림 (FR-08·FR-09, DEC-084).
 * 닭가슴살 2팩을 매일 점심 1팩씩 먹는 식단표. 가짜 발송기로 web-push 를 대신하고 tick 에 시각을 넣어 돌린다.
 */
import { createECDH } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { addDays, toDbDate } from '../src/domain/dates';
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
const at = (hhmm: string): Date => new Date(`${TODAY}T${hhmm}:00+09:00`);
const MIN = 60_000;

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
  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    this.calls.push({ endpoint: target.endpoint, payload });
    return { kind: 'ok', status: 201 };
  }
}

describe('phase 2: day-complete and stock depletion notifications (DEC-084)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let scheduler: NotificationScheduler;
  let chicken: string;
  let egg: string;
  const fake = new FakeSender();

  const rows = (type: 'day_complete' | 'stock_depletion') =>
    prisma.notificationDelivery.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });
  /** 오늘 보낸 소진 알림을 n일 전 날짜의 것으로 옮긴다(하루 한 통 제한을 비켜 다음 날을 흉내 낸다) */
  const ageStockRows = async (days: number) => {
    await prisma.notificationDelivery.updateMany({
      where: { type: 'stock_depletion', targetDate: toDbDate(TODAY) },
      data: { targetDate: toDbDate(addDays(TODAY, -days)) },
    });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp({ env: VAPID, pushSender: fake }));
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    server = app.getHttpServer();
    scheduler = app.get(NotificationScheduler);
    a = api(server, await login(server, 'extra-a', 'A'));

    const create = async (name: string): Promise<string> =>
      (await a.post('/products').send({ name, stockUnit: 'ea', unitLabel: '개' }).expect(201)).body
        .id;
    chicken = await create('닭가슴살');
    egg = await create('달걀');
    const receive = (productId: string, quantity: number) =>
      a
        .post('/purchases')
        .send({ productId, quantity, purchasedOn: TODAY, received: true })
        .expect(201);
    await receive(chicken, 2);
    await receive(egg, 30);

    const template = (
      await a
        .post('/meal-templates')
        .send({
          name: '점심',
          items: [
            { productId: chicken, quantity: 1, unit: 'ea' },
            { productId: egg, quantity: 1, unit: 'ea' },
          ],
        })
        .expect(201)
    ).body.id;
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      await a
        .put(`/plans/weekly/${weekday}/lunch`)
        .send({ planType: 'template', templateId: template })
        .expect(200);
    }
    // 쓰는 끼니는 점심 하나, 그 시각은 00:00: 하루 완료 알림의 '가장 늦은 끼니 시각' 이 늘 지나 있게
    await a
      .patch('/me')
      .send({ activeSlots: ['lunch'] })
      .expect(200);
    await a
      .put('/notification-settings/lunch')
      .send({ enabled: false, notifyMinute: 0 })
      .expect(200);
    await a
      .post('/push/subscriptions')
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/extra-a', keys: KEYS })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fake.calls = [];
  });

  it('both kinds are on by default without a settings row, stock at 09:00', async () => {
    const res = await a.get('/notification-settings').expect(200);
    const by = Object.fromEntries(res.body.map((s: { kind: string }) => [s.kind, s]));
    expect(by.day_complete).toMatchObject({ enabled: true });
    expect(by.stock_depletion).toMatchObject({ enabled: true, notifyMinute: 540, daysBefore: 3 });
    expect(by.lunch).toMatchObject({ enabled: false });
  });

  // ---------- 소진 알림 ----------

  it('sends one stock alert at the set time for an imminent product, linking to it', async () => {
    expect(await scheduler.tick(at('08:59'))).toMatchObject({ claimed: 0 });
    expect(await scheduler.tick(at('09:00'))).toMatchObject({ claimed: 1, sent: 1 });
    // 닭가슴살 2개 → 오늘·내일을 채우고 모레에 모자란다. 달걀 30개는 임박이 아니다
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.payload).toEqual({
      title: '닭가슴살 곧 떨어져요',
      body: expect.stringContaining('2일 뒤'),
      url: `/products/${chicken}`,
      tag: `stock-${TODAY}`,
    });
    const [row] = await rows('stock_depletion');
    expect(row).toMatchObject({ targetKey: 'bundle', seq: 0, status: 'sent' });
    expect((row!.payload as { productIds: string[] }).productIds).toEqual([chicken]);

    // 같은 날은 한 통뿐
    expect(await scheduler.tick(at('09:05'))).toMatchObject({ claimed: 0 });
  });

  it('does not repeat a product while it stays imminent', async () => {
    const alerted = await prisma.product.findUniqueOrThrow({ where: { id: chicken } });
    expect(alerted.depletionAlertedAt).not.toBeNull();

    await ageStockRows(1);
    expect(await scheduler.tick(at('09:00'))).toMatchObject({ claimed: 0 });
    expect(await rows('stock_depletion')).toHaveLength(1);

    // 계획을 바꿔 떨어질 날만 움직이거나, 남은 양을 조금 올려 맞춰도(여전히 임박) 다시 알리지 않는다
    await a
      .put(`/plans/overrides/${addDays(TODAY, 1)}/lunch`)
      .send({ planType: 'none' })
      .expect(200);
    await a.post(`/stock/${chicken}/adjustments`).send({ measuredQuantity: 2.5 }).expect(201);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:01'))).toMatchObject({ claimed: 0 });
  });

  it('alerts again once the product left the imminent state, bundling several products', async () => {
    // 닭가슴살을 넉넉히 채우면 다음 판정에서 '알렸음' 이 지워진다
    await a.post(`/stock/${chicken}/adjustments`).send({ measuredQuantity: 30 }).expect(201);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:02'))).toMatchObject({ claimed: 0 });
    const reset = await prisma.product.findUniqueOrThrow({ where: { id: chicken } });
    expect(reset.depletionAlertedAt).toBeNull();

    // 다시 줄어 닭가슴살·달걀이 함께 임박 → 한 통으로 묶는다
    await a.post(`/stock/${chicken}/adjustments`).send({ measuredQuantity: 2 }).expect(201);
    await a.post(`/stock/${egg}/adjustments`).send({ measuredQuantity: 2 }).expect(201);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:03'))).toMatchObject({ claimed: 1, sent: 1 });
    const payload = fake.calls[0]!.payload;
    expect(payload.title).toMatch(/외 1개가 곧 떨어져요$/);
    expect(payload.url).toBe('/products');
    expect(payload).not.toHaveProperty('productIds');
    const all = await rows('stock_depletion');
    expect((all[1]!.payload as { productIds: string[] }).productIds.sort()).toEqual(
      [chicken, egg].sort(),
    );
  });

  it('skips products on order, respects the off switch and the chosen time', async () => {
    await ageStockRows(2);
    // 달걀을 채웠다가 다시 줄여 알림 대상으로 만든 뒤 주문을 넣는다 → 배송 중이라 알리지 않는다
    await a.post(`/stock/${egg}/adjustments`).send({ measuredQuantity: 30 }).expect(201);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:00'))).toMatchObject({ claimed: 0 });
    await a.post(`/stock/${egg}/adjustments`).send({ measuredQuantity: 2 }).expect(201);
    const order = await a
      .post('/purchases')
      .send({ productId: egg, quantity: 30, purchasedOn: TODAY })
      .expect(201);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:01'))).toMatchObject({ claimed: 0 });

    // 주문을 취소하면 대상이지만 알림을 끄면 보내지 않는다
    await a.post(`/purchases/${order.body.id}/cancel`).expect(200);
    await a.put('/notification-settings/stock_depletion').send({ enabled: false }).expect(200);
    scheduler.forgetStockChecks();
    expect(await scheduler.tick(at('09:02'))).toMatchObject({ claimed: 0 });

    // 시각을 10:30 으로 옮기면 그때 간다
    await a
      .put('/notification-settings/stock_depletion')
      .send({ enabled: true, notifyMinute: 630 })
      .expect(200);
    expect(await scheduler.tick(at('09:03'))).toMatchObject({ claimed: 0 });
    expect(await scheduler.tick(at('10:30'))).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.calls[0]!.payload.title).toBe('달걀 곧 떨어져요');
  });

  it('daily cleanup clears the alerted mark of products that are no longer imminent', async () => {
    const mark = async () =>
      (await prisma.product.findUniqueOrThrow({ where: { id: egg } })).depletionAlertedAt;
    expect(await mark()).not.toBeNull();
    // 소진 알림을 꺼 둔 동안 채워도, 매일 정리 작업이 표시를 지워 다음에 다시 알릴 수 있다
    await a.put('/notification-settings/stock_depletion').send({ enabled: false }).expect(200);
    const maintenance = app.get(MaintenanceService);
    expect(await maintenance.cleanup(new Date())).toMatchObject({ alertResets: 0 });
    await a.post(`/stock/${egg}/adjustments`).send({ measuredQuantity: 30 }).expect(201);
    expect(await maintenance.cleanup(new Date())).toMatchObject({ alertResets: 1 });
    expect(await mark()).toBeNull();
    expect(await maintenance.cleanup(new Date())).toMatchObject({ alertResets: 0 });
  });

  // ---------- 하루 완료 알림 ----------

  it('reminds to complete the day one hour after the last planned meal is recorded', async () => {
    // 미기록 식단 끼니가 있으면 보내지 않는다
    const soon = () => new Date(Date.now() + 61 * MIN);
    await scheduler.tick(soon());
    expect(await rows('day_complete')).toHaveLength(0);

    const first = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'skipped', items: [], version: null })
      .expect(200);
    // 기록 직후에는 아직 아니다
    await scheduler.tick(new Date(Date.now() + 30 * MIN));
    expect(await rows('day_complete')).toHaveLength(0);

    fake.calls = [];
    await scheduler.tick(soon());
    const sent = fake.calls.filter((c) => c.payload.tag === `day-complete-${TODAY}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({
      body: '하루 완료를 눌러 마무리해 주세요',
      url: `/day/${TODAY}`,
    });
    expect(await rows('day_complete')).toMatchObject([
      { targetKey: 'day', seq: 0, status: 'sent', slot: null },
    ]);

    // 하루에 한 번만: 기록을 고쳐 다시 조건이 맞아도 보내지 않는다
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'skipped', items: [], version: first.body.version })
      .expect(200);
    await scheduler.tick(soon());
    expect(await rows('day_complete')).toHaveLength(1);

    // 발송이 실패한 날은 보낸 것으로 세지 않고 다음 회차로 다시 보낸다
    await prisma.notificationDelivery.updateMany({
      where: { type: 'day_complete' },
      data: { status: 'failed', sentAt: null },
    });
    fake.calls = [];
    await scheduler.tick(soon());
    expect(await rows('day_complete')).toMatchObject([
      { seq: 0, status: 'failed' },
      { seq: 1, status: 'sent' },
    ]);
    expect(fake.calls.filter((c) => c.payload.tag === `day-complete-${TODAY}`)).toHaveLength(1);

    // 같은 예약 시각으로는 다시 보내지 않는다(실패 직후 매분 재시도하지 않는다)
    await prisma.notificationDelivery.updateMany({
      where: { type: 'day_complete', seq: 1 },
      data: { status: 'failed', sentAt: null },
    });
    await scheduler.tick(soon());
    expect(await rows('day_complete')).toHaveLength(2);
  });

  it('waits for the latest slot in use before reminding', async () => {
    await prisma.notificationDelivery.deleteMany({ where: { type: 'day_complete' } });
    // 점심 시각을 23:59 로 두면, 기록 1시간 뒤여도 그 시각 전에는 보내지 않는다
    await a
      .put('/notification-settings/lunch')
      .send({ enabled: false, notifyMinute: 1439 })
      .expect(200);
    await scheduler.tick(new Date(Date.now() + 61 * MIN));
    const sent = await rows('day_complete');
    const beforeLastSlot = Date.now() + 61 * MIN < at('23:59').getTime();
    expect(sent).toHaveLength(beforeLastSlot ? 0 : 1);
    await a
      .put('/notification-settings/lunch')
      .send({ enabled: false, notifyMinute: 0 })
      .expect(200);
  });

  it('does not remind when the day is already completed or the reminder is off', async () => {
    await prisma.notificationDelivery.deleteMany({ where: { type: 'day_complete' } });
    await a.put('/notification-settings/day_complete').send({ enabled: false }).expect(200);
    await scheduler.tick(new Date(Date.now() + 61 * MIN));
    expect(await rows('day_complete')).toHaveLength(0);

    await a.put('/notification-settings/day_complete').send({ enabled: true }).expect(200);
    await a.put(`/days/${TODAY}/completion`).send({}).expect(200);
    await scheduler.tick(new Date(Date.now() + 61 * MIN));
    expect(await rows('day_complete')).toHaveLength(0);
  });
});
