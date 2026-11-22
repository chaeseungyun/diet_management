/**
 * 끼니 공유 차단 (sharing-plan §5·§9-4, DEC-097).
 * 차단하면 친구가 끊기고, 다시 친구가 될 수 없고, 같은 친구의 끼니에 남긴 반응·댓글도 서로에게 숨는다.
 * 상대 쪽에서는 친구 끊기와 구별되지 않아야 한다.
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');

describe('phase 4: sharing block', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  type Api = ReturnType<typeof api>;
  let a: Api;
  let b: Api;
  let c: Api;
  let aId: string;
  let bId: string;
  let cId: string;
  let aLunch: string;
  let cLunch: string;

  const me = async (who: Api) => (await who.get('/me').expect(200)).body.id as string;
  const invite = async (from: Api) =>
    (await from.post('/friend-invites').send({}).expect(201)).body.code as string;
  const befriend = async (from: Api, to: Api) => {
    await to
      .post(`/friend-invites/${await invite(from)}/accept`)
      .send({})
      .expect(200);
  };
  const eatLunch = async (who: Api) =>
    (
      await who
        .put(`/meal-records/${TODAY}/lunch`)
        .send({
          status: 'eaten',
          kind: 'outside',
          outsideItems: [{ name: '김치찌개' }],
          version: null,
        })
        .expect(200)
    ).body.id as string;
  const rec = (ownerId: string, recordId: string) => `/friends/${ownerId}/meal-records/${recordId}`;
  const friendIds = async (who: Api) =>
    ((await who.get('/friends').expect(200)).body as { userId: string }[]).map((f) => f.userId);
  const commentAuthors = async (who: Api, ownerId: string, recordId: string) =>
    ((await who.get(`${rec(ownerId, recordId)}/comments`).expect(200)).body as { userId: string }[])
      .map((x) => x.userId)
      .sort();
  /** 친구의 하루에서 본 그 끼니의 반응 수·댓글 수 */
  const socialOf = async (who: Api, ownerId: string) => {
    const day = (await who.get(`/friends/${ownerId}/days/${TODAY}`).expect(200)).body as {
      slots: { slot: string; social: { reactions: { count: number }[]; commentCount: number } }[];
    };
    const s = day.slots.find((x) => x.slot === 'lunch')!.social;
    return { reactions: s.reactions.reduce((n, r) => n + r.count, 0), comments: s.commentCount };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'block-a', '에이'));
    b = api(server, await login(server, 'block-b', '비'));
    c = api(server, await login(server, 'block-c', '씨'));
    [aId, bId, cId] = [await me(a), await me(b), await me(c)];
  });

  afterAll(async () => {
    await app.close();
  });

  // A·B·C 모두 서로 친구이고 공개. A 와 C 의 오늘 점심이 있고, A·B 가 C 의 점심에, B 가 A 의 점심에 반응·댓글을 남겼다
  beforeEach(async () => {
    await befriend(a, b);
    await befriend(c, a);
    await befriend(c, b);
    for (const who of [a, b, c]) {
      await who.put('/me/sharing').send({ visibility: 'friends' }).expect(200);
    }
    aLunch = await eatLunch(a);
    cLunch = await eatLunch(c);
    for (const who of [a, b]) {
      await who
        .put(`${rec(cId, cLunch)}/reaction`)
        .send({ emoji: '🔥' })
        .expect(200);
      await who
        .post(`${rec(cId, cLunch)}/comments`)
        .send({ body: '맛있겠다' })
        .expect(201);
    }
    await b
      .put(`${rec(aId, aLunch)}/reaction`)
      .send({ emoji: '👍' })
      .expect(200);
    await b
      .post(`${rec(aId, aLunch)}/comments`)
      .send({ body: '부럽다' })
      .expect(201);
  });

  afterEach(async () => {
    await prisma.friendLink.deleteMany({});
    await prisma.friendInvite.deleteMany({});
    await prisma.mealRecord.deleteMany({});
    await prisma.user.updateMany({ data: { shareVisibility: 'private' } });
  });

  it('blocks a friend: both sides lose each other, and only the blocker sees the block', async () => {
    await a.post(`/friends/${bId}/block`).expect(204);
    // 다시 눌러도 그대로 성공
    await a.post(`/friends/${bId}/block`).expect(204);

    expect(await friendIds(a)).toEqual([cId]);
    expect(await friendIds(b)).toEqual([cId]);
    expect((await a.get('/friends/blocked').expect(200)).body).toEqual([
      { userId: bId, nickname: '비' },
    ]);
    // 차단당한 쪽에는 차단 목록에 아무것도 없고, 친구 끊기와 같은 404 만 보인다
    expect((await b.get('/friends/blocked').expect(200)).body).toEqual([]);
    await b.get(`/friends/${aId}/days/${TODAY}`).expect(404);
    await a.get(`/friends/${bId}/days/${TODAY}`).expect(404);
    await b
      .put(`${rec(aId, aLunch)}/reaction`)
      .send({ emoji: '😋' })
      .expect(404);
    await b
      .post(`${rec(aId, aLunch)}/comments`)
      .send({ body: '왜' })
      .expect(404);
    // 차단당한 쪽은 되차단·해제·끊기·숨기기 모두 404
    await b.post(`/friends/${aId}/block`).expect(404);
    await b.delete(`/friends/${aId}/block`).expect(404);
    await b.delete(`/friends/${aId}`).expect(404);
    await b.patch(`/friends/${aId}`).send({ shareToFriend: false }).expect(404);
  });

  it('keeps them apart: invite links from either side are 404', async () => {
    await a.post(`/friends/${bId}/block`).expect(204);
    await b
      .post(`/friend-invites/${await invite(a)}/accept`)
      .send({})
      .expect(404);
    await a
      .post(`/friend-invites/${await invite(b)}/accept`)
      .send({})
      .expect(404);
    expect(await friendIds(a)).toEqual([cId]);
  });

  it('hides their reactions and comments from each other, also on a mutual friend’s meal', async () => {
    await a.post(`/friends/${bId}/block`).expect(204);

    // C 의 끼니: A 와 B 는 서로의 댓글·반응을 보지 못한다. C 는 둘 다 본다
    expect(await commentAuthors(a, cId, cLunch)).toEqual([aId]);
    expect(await commentAuthors(b, cId, cLunch)).toEqual([bId]);
    expect(await commentAuthors(c, cId, cLunch)).toEqual([aId, bId].sort());
    expect(await socialOf(a, cId)).toEqual({ reactions: 1, comments: 1 });
    expect(await socialOf(b, cId)).toEqual({ reactions: 1, comments: 1 });

    // A 자기 끼니: B 가 전에 남긴 반응·댓글이 숨는다(행은 남아 있다)
    expect(await commentAuthors(a, aId, aLunch)).toEqual([]);
    const mine = (await a.get(`/days/${TODAY}/social`).expect(200)).body as {
      recordId: string;
      reactions: unknown[];
      commentCount: number;
    }[];
    expect(mine.find((s) => s.recordId === aLunch)).toMatchObject({
      reactions: [],
      commentCount: 0,
    });
    expect(await prisma.mealComment.count({ where: { mealRecordId: aLunch } })).toBe(1);
    // 주인 A 가 차단한 B 의 흔적은 A 의 끼니에서 제3자 C 에게도 숨는다(주인이 지울 수 없는 댓글이 남지 않게)
    expect(await commentAuthors(c, aId, aLunch)).toEqual([]);
    expect(await socialOf(c, aId)).toEqual({ reactions: 0, comments: 0 });
    const onA = await prisma.mealComment.findFirstOrThrow({
      where: { mealRecordId: aLunch, userId: bId },
    });
    await c.put(`/comments/${onA.id}/like`).expect(404);

    // 숨은 댓글은 id 를 알아도 좋아요할 수 없다
    const bComment = await prisma.mealComment.findFirstOrThrow({
      where: { mealRecordId: cLunch, userId: bId },
    });
    await a.put(`/comments/${bComment.id}/like`).expect(404);
  });

  it('unblocks without becoming friends; hidden activity comes back', async () => {
    await a.post(`/friends/${bId}/block`).expect(204);
    await a.delete(`/friends/${bId}/block`).expect(204);
    await a.delete(`/friends/${bId}/block`).expect(404);

    expect((await a.get('/friends/blocked').expect(200)).body).toEqual([]);
    expect(await friendIds(a)).toEqual([cId]);
    expect(await commentAuthors(a, cId, cLunch)).toEqual([aId, bId].sort());
    // 다시 초대 링크로 친구가 될 수 있다
    await befriend(a, b);
    expect((await friendIds(a)).sort()).toEqual([bId, cId].sort());
  });

  it('only blocks current friends, with the same 404 for anyone else', async () => {
    await a.delete(`/friends/${bId}`).expect(204);
    await a.post(`/friends/${bId}/block`).expect(404);
    await a.post(`/friends/${randomUUID()}/block`).expect(404);
    await a.post(`/friends/${aId}/block`).expect(404);
    await a.delete(`/friends/${cId}/block`).expect(404);
  });
});
