/**
 * 끼니 공유-2b (DEC-096): 친구 소식 알림 — 반응·댓글·댓글 좋아요·친구 수락.
 * 일이 생긴 요청에서 바로 보내므로, 요청 뒤 SocialNotifyService.idle() 로 뒤의 발송을 기다린 다음 확인한다.
 */
import { createECDH } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { NotificationScheduler } from '../src/notifications/notification-scheduler';
import type {
  PushPayload,
  PushSender,
  PushTarget,
  SendResult,
} from '../src/notifications/push-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { SocialNotifyService } from '../src/sharing/social-notify.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const KEYS = {
  p256dh: 'BOr5x2bD0z7xXq9vY1kq0y6sQ0b0lQe2c4c1s3m5n7p9r1t3v5x7',
  auth: 'k3Jz8wQ1u5Yt2Pq9Lm4NcA',
};
const EP = (who: string) => `https://fcm.googleapis.com/fcm/send/social-${who}`;

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const VAPID = {
  VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
  VAPID_SUBJECT: 'mailto:ops@example.com',
};

class FakeSender implements PushSender {
  calls: { endpoint: string; payload: PushPayload }[] = [];
  queue: SendResult[] = [];
  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    this.calls.push({ endpoint: target.endpoint, payload });
    return this.queue.shift() ?? { kind: 'ok', status: 201 };
  }
}

describe('phase 4: sharing-2b (social notifications)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notify: SocialNotifyService;
  let scheduler: NotificationScheduler;
  const fake = new FakeSender();
  type Api = ReturnType<typeof api>;
  let a: Api;
  let b: Api;
  let c: Api;
  let d: Api;
  let aId: string;
  let bId: string;
  let lunch: string;

  const me = async (who: Api) => (await who.get('/me').expect(200)).body.id as string;
  const befriend = async (from: Api, to: Api) => {
    const { code } = (await from.post('/friend-invites').send({}).expect(201)).body;
    await to.post(`/friend-invites/${code}/accept`).send({}).expect(200);
  };
  const rec = (recordId = lunch) => `/friends/${aId}/meal-records/${recordId}`;
  /** 뒤에서 보내는 알림을 기다린 뒤 받은 기기별 제목 */
  const sent = async () => {
    await notify.idle();
    return fake.calls.map((x) => ({
      to: x.endpoint.split('social-')[1],
      title: x.payload.title,
      url: x.payload.url,
    }));
  };
  const reset = async () => {
    await notify.idle();
    fake.calls = [];
    fake.queue = [];
    await prisma.notificationDelivery.deleteMany({});
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp({ env: VAPID, pushSender: fake }));
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    notify = app.get(SocialNotifyService);
    scheduler = app.get(NotificationScheduler);
    a = api(server, await login(server, 'notify-a', '에이'));
    b = api(server, await login(server, 'notify-b', '비'));
    c = api(server, await login(server, 'notify-c', '씨'));
    d = api(server, await login(server, 'notify-d', '디'));
    [aId, bId] = [await me(a), await me(b)];
    // D 는 구독이 없다
    for (const [who, name] of [
      [a, 'a'],
      [b, 'b'],
      [c, 'c'],
    ] as const) {
      await who
        .post('/push/subscriptions')
        .send({ endpoint: EP(name), keys: KEYS })
        .expect(200);
    }
  });

  afterAll(async () => {
    await notify.idle();
    await app.close();
  });

  // A 는 공개, B·C 는 A 의 친구. A 의 오늘 점심 기록이 하나 있다
  beforeEach(async () => {
    await befriend(a, b);
    await befriend(a, c);
    await a.put('/me/sharing').send({ visibility: 'friends' }).expect(200);
    lunch = (
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send({
          status: 'eaten',
          kind: 'outside',
          outsideItems: [{ name: '김치찌개' }],
          version: null,
        })
        .expect(200)
    ).body.id;
    await reset();
  });

  afterEach(async () => {
    await notify.idle();
    await prisma.friendLink.deleteMany({});
    await prisma.friendInvite.deleteMany({});
    await prisma.mealRecord.deleteMany({});
    await prisma.notificationSetting.deleteMany({});
    await prisma.user.updateMany({ data: { shareVisibility: 'private' } });
  });

  it('tells the owner about a reaction once per friend and record', async () => {
    await b.put(`${rec()}/reaction`).send({ emoji: '🔥' }).expect(200);
    expect(await sent()).toEqual([
      { to: 'a', title: '비님이 ' + label() + '에 🔥 반응했어요', url: `/day/${TODAY}` },
    ]);
    // 바꾸거나 지웠다 다시 눌러도 다시 보내지 않는다
    await b.put(`${rec()}/reaction`).send({ emoji: '👍' }).expect(200);
    await b.delete(`${rec()}/reaction`).expect(200);
    await b.put(`${rec()}/reaction`).send({ emoji: '😋' }).expect(200);
    await c.put(`${rec()}/reaction`).send({ emoji: '👏' }).expect(200);
    expect((await sent()).map((x) => x.title)).toEqual([
      `비님이 ${label()}에 🔥 반응했어요`,
      `씨님이 ${label()}에 👏 반응했어요`,
    ]);
    expect(
      await prisma.notificationDelivery.findMany({
        select: { type: true, status: true, targetKey: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { type: 'friend_reaction', status: 'sent', targetKey: `${lunch}:${bId}` },
      ]),
    );
  });

  it('sends every comment to the owner and earlier commenters, never to the writer', async () => {
    await b.post(`${rec()}/comments`).send({ body: '맛있겠다' }).expect(201);
    expect(await sent()).toEqual([
      { to: 'a', title: `비님의 댓글 · ${label()}`, url: `/day/${TODAY}?comments=${lunch}` },
    ]);
    fake.calls = [];

    // 주인의 답글은 먼저 단 B 에게, 친구의 하루 경로로
    await a.post(`${rec()}/comments`).send({ body: '응 맛있어' }).expect(201);
    expect(await sent()).toEqual([
      {
        to: 'b',
        title: `에이님의 댓글 · ${label()}`,
        url: `/friends/${aId}/day/${TODAY}?comments=${lunch}`,
      },
    ]);
    fake.calls = [];

    // C 의 댓글은 주인 A 와 먼저 단 B 에게. 같은 사람이 또 달면 또 간다
    await c.post(`${rec()}/comments`).send({ body: '나도' }).expect(201);
    await c.post(`${rec()}/comments`).send({ body: '먹고 싶다' }).expect(201);
    const got = await sent();
    expect(got.filter((x) => x.to === 'a')).toHaveLength(2);
    expect(got.filter((x) => x.to === 'b')).toHaveLength(2);
    expect(got.filter((x) => x.to === 'c')).toHaveLength(0);
    // 본문은 댓글 미리보기, 같은 끼니의 댓글 알림은 같은 tag
    const last = fake.calls[fake.calls.length - 1]!.payload;
    expect(last).toMatchObject({ body: '먹고 싶다', tag: `comment-${lunch}` });
  });

  it('skips an earlier commenter who can no longer see the meal', async () => {
    await b.post(`${rec()}/comments`).send({ body: '맛있겠다' }).expect(201);
    await reset();
    // A 가 B 에게만 숨긴다(친구별 끄기)
    await a.patch(`/friends/${bId}`).send({ shareToFriend: false }).expect(200);
    await c.post(`${rec()}/comments`).send({ body: '나도' }).expect(201);
    expect((await sent()).map((x) => x.to)).toEqual(['a']);
  });

  it('sends nothing between people who blocked each other (DEC-097)', async () => {
    // B 와 C 가 친구였다가 C 가 B 를 차단했다. 둘 다 A 의 친구라 A 의 끼니는 둘 다 본다
    await befriend(b, c);
    await c.post(`/friends/${bId}/block`).expect(204);
    await b.post(`${rec()}/comments`).send({ body: '맛있겠다' }).expect(201);
    await reset();
    // C 의 댓글은 주인 A 에게만, 먼저 단 B 에게는 가지 않는다
    await c.post(`${rec()}/comments`).send({ body: '나도' }).expect(201);
    expect((await sent()).map((x) => x.to)).toEqual(['a']);
  });

  it('tells a comment writer about a like once, and not about their own', async () => {
    await b.post(`${rec()}/comments`).send({ body: '맛있겠다' }).expect(201);
    const [comment] = (await a.get(`${rec()}/comments`).expect(200)).body as { id: string }[];
    await reset();

    await a.put(`/comments/${comment!.id}/like`).expect(200);
    await a.delete(`/comments/${comment!.id}/like`).expect(200);
    await a.put(`/comments/${comment!.id}/like`).expect(200);
    await b.put(`/comments/${comment!.id}/like`).expect(200);
    expect(await sent()).toEqual([
      {
        to: 'b',
        title: '에이님이 내 댓글을 좋아해요',
        url: `/friends/${aId}/day/${TODAY}?comments=${lunch}`,
      },
    ]);
  });

  it('tells the inviter when someone accepts; nobody without a subscription gets a row', async () => {
    await befriend(a, d);
    expect(await sent()).toEqual([{ to: 'a', title: '디님과 친구가 됐어요', url: '/friends' }]);
    // D 는 구독이 없어 A 의 반응을 받을 수 없지만(소유자도 아님) 행도 남지 않는다
    await befriend(d, b);
    expect((await sent()).map((x) => x.to)).toEqual(['a']);
    expect(await prisma.notificationDelivery.count({ where: { type: 'friend_accepted' } })).toBe(1);
  });

  it('respects the social switch (default on)', async () => {
    const list = (await a.get('/notification-settings').expect(200)).body as {
      kind: string;
      enabled: boolean;
    }[];
    expect(list.find((s) => s.kind === 'social')).toMatchObject({ enabled: true });

    await a.put('/notification-settings/social').send({ enabled: false }).expect(200);
    await b.put(`${rec()}/reaction`).send({ emoji: '🔥' }).expect(200);
    await b.post(`${rec()}/comments`).send({ body: '맛있겠다' }).expect(201);
    expect(await sent()).toEqual([]);
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it('leaves a transient failure pending for the scheduler to retry', async () => {
    fake.queue = [{ kind: 'transient', status: 503, reason: 'busy' }];
    await b.put(`${rec()}/reaction`).send({ emoji: '🔥' }).expect(200);
    await sent();
    expect(await prisma.notificationDelivery.findFirst()).toMatchObject({
      type: 'friend_reaction',
      status: 'pending',
      attempts: 1,
    });
    // 임대(50초)가 지난 다음 실행이 다시 보낸다
    const r = await scheduler.tick(new Date(Date.now() + 60_000));
    expect(r).toMatchObject({ retried: 1, sent: 1 });
    expect(await prisma.notificationDelivery.findFirst()).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
  });
});

/** 오늘 점심의 알림 문구 속 이름 '11월 17일 점심' */
function label(): string {
  const [, m, d] = TODAY.split('-').map(Number);
  return `${m}월 ${d}일 점심`;
}
