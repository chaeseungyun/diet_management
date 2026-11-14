/**
 * 알림 설정·푸시 구독 (FR-09, DEC-074, api.md §11, S-71).
 * 발송 판정·스케줄러는 다음 단계에서 추가한다. 여기서는 저장·검증·사용자 격리만 본다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, login } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

const FCM = 'https://fcm.googleapis.com/fcm/send/device-1:abc';
const KEYS = {
  p256dh: 'BOr5x2bD0z7xXq9vY1kq0y6sQ0b0lQe2c4c1s3m5n7p9r1t3v5x7z9B1D3F5H7J9L1N3P5R7T9V1X3Z5b7d9f1h',
  auth: 'k3Jz8wQ1u5Yt2Pq9Lm4NcA',
};

describe('phase 2: notification settings & push subscriptions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // 다른 파일이 남긴 구독(endpoint 전역 유니크)까지 지운다
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    server = app.getHttpServer();
    a = api(server, await login(server, 'notif-a', 'A'));
    b = api(server, await login(server, 'notif-b', 'B'));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns all 8 kinds; meals and repeat off, day-complete and stock on by default (DEC-084)', async () => {
    const res = await a.get('/notification-settings').expect(200);
    expect(res.body.map((s: { kind: string }) => s.kind)).toEqual([
      'breakfast',
      'lunch',
      'afternoon_snack',
      'dinner',
      'evening_snack',
      'unrecorded_remind',
      'day_complete',
      'stock_depletion',
    ]);
    expect(
      res.body.filter((s: { enabled: boolean }) => s.enabled).map((s: { kind: string }) => s.kind),
    ).toEqual(['day_complete', 'stock_depletion']);
    const remind = res.body.find((s: { kind: string }) => s.kind === 'unrecorded_remind');
    expect(remind).toMatchObject({ remindAfterMinutes: 60, remindMaxCount: 1 });
    const stock = res.body.find((s: { kind: string }) => s.kind === 'stock_depletion');
    expect(stock).toMatchObject({ daysBefore: 3, notifyMinute: 540 });
    expect(stock.available).toBeUndefined();
  });

  it('requires a time to enable a meal reminder and keeps it when toggled', async () => {
    await a.put('/notification-settings/lunch').send({ enabled: true }).expect(422);
    await a
      .put('/notification-settings/lunch')
      .send({ enabled: true, notifyMinute: 720 })
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({ kind: 'lunch', enabled: true, notifyMinute: 720 }),
      );
    // 끄고 다시 켤 때 시각을 다시 보내지 않아도 된다
    await a.put('/notification-settings/lunch').send({ enabled: false }).expect(200);
    const on = await a.put('/notification-settings/lunch').send({ enabled: true }).expect(200);
    expect(on.body.notifyMinute).toBe(720);
  });

  it('validates ranges and unknown kinds', async () => {
    await a
      .put('/notification-settings/lunch')
      .send({ enabled: true, notifyMinute: 1440 })
      .expect(422);
    await a
      .put('/notification-settings/unrecorded_remind')
      .send({ enabled: true, remindMaxCount: 4 })
      .expect(422);
    await a
      .put('/notification-settings/unrecorded_remind')
      .send({ enabled: true, remindMaxCount: 3, remindAfterMinutes: 30 })
      .expect(200)
      .expect((r) => expect(r.body).toMatchObject({ remindMaxCount: 3, remindAfterMinutes: 30 }));
    await a.put('/notification-settings/extra').send({ enabled: true }).expect(404);
  });

  it('isolates settings per user', async () => {
    const res = await b.get('/notification-settings').expect(200);
    expect(res.body.find((s: { kind: string }) => s.kind === 'lunch').enabled).toBe(false);
  });

  it('reports no public key when VAPID is not configured', async () => {
    await a.get('/push/public-key').expect(200, { publicKey: null });
  });

  it('accepts only known push services (SSRF)', async () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/x',
      'https://169.254.169.254/x',
      'https://localhost/x',
    ]) {
      await a.post('/push/subscriptions').send({ endpoint, keys: KEYS }).expect(422);
    }
    await a
      .post('/push/subscriptions')
      .send({ endpoint: FCM, keys: { p256dh: 'not base64!', auth: KEYS.auth } })
      .expect(422);
  });

  it('upserts by endpoint and moves the device to the last account', async () => {
    const first = await a
      .post('/push/subscriptions')
      .set('User-Agent', 'e2e-agent')
      .send({ endpoint: FCM, expirationTime: null, keys: KEYS })
      .expect(200);
    // 같은 기기·같은 계정 재등록 = 같은 행
    const again = await a
      .post('/push/subscriptions')
      .send({ endpoint: FCM, keys: KEYS })
      .expect(200);
    expect(again.body.id).toBe(first.body.id);

    // 같은 기기에서 B 로 로그인해 등록 → 소유자가 B 로
    await b.post('/push/subscriptions').send({ endpoint: FCM, keys: KEYS }).expect(200);
    const row = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: FCM },
      include: { user: true },
    });
    expect(row.user.kakaoId).toBe('notif-b');

    // A 는 더 이상 이 구독을 해제할 수 없다 (D-06: 404)
    await a.post('/push/subscriptions/unsubscribe').send({ endpoint: FCM }).expect(404);
  });

  it('unsubscribes idempotently for the owner and reactivates on re-subscribe', async () => {
    await b.post('/push/subscriptions/unsubscribe').send({ endpoint: FCM }).expect(204);
    await b.post('/push/subscriptions/unsubscribe').send({ endpoint: FCM }).expect(204);
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: FCM } })).revokedAt,
    ).not.toBeNull();

    await b.post('/push/subscriptions').send({ endpoint: FCM, keys: KEYS }).expect(200);
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: FCM } })).revokedAt,
    ).toBeNull();
  });

  it('enable-meals turns on the slots in use once, keeping saved times (DEC-077)', async () => {
    const c = api(server, await login(server, 'notif-c', 'C'));
    await c
      .patch('/me')
      .send({ activeSlots: ['breakfast', 'lunch', 'dinner'] })
      .expect(200);
    // 저녁은 시각만 저장해 두고 꺼 둔 상태
    await c
      .put('/notification-settings/dinner')
      .send({ enabled: false, notifyMinute: 1140 })
      .expect(200);

    const first = await c.post('/notification-settings/enable-meals').expect(200);
    expect(first.body.applied).toBe(true);
    expect(first.body.enabledKinds).toEqual(['breakfast', 'lunch', 'dinner']);
    const byKind = Object.fromEntries(
      first.body.settings.map((s: { kind: string }) => [s.kind, s]),
    ) as Record<string, { enabled: boolean; notifyMinute: number | null }>;
    expect(byKind.breakfast).toMatchObject({ enabled: true, notifyMinute: 480 });
    expect(byKind.lunch).toMatchObject({ enabled: true, notifyMinute: 720 });
    expect(byKind.dinner).toMatchObject({ enabled: true, notifyMinute: 1140 }); // 저장된 시각 유지
    expect(byKind.afternoon_snack).toMatchObject({ enabled: false, notifyMinute: null }); // 쓰지 않는 끼니
    expect(byKind.unrecorded_remind!.enabled).toBe(false); // 재알림은 건드리지 않음

    // 하나라도 켜져 있으면 사용자가 고른 것이라 바꾸지 않는다
    await c.put('/notification-settings/breakfast').send({ enabled: false }).expect(200);
    const again = await c.post('/notification-settings/enable-meals').expect(200);
    expect(again.body).toMatchObject({ applied: false, enabledKinds: [] });
    const now = await c.get('/notification-settings').expect(200);
    expect(now.body.find((s: { kind: string }) => s.kind === 'breakfast').enabled).toBe(false);
  });

  it('requires login', async () => {
    await request(server).get('/api/v1/notification-settings').expect(401);
  });
});
