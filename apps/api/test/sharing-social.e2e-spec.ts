/**
 * 끼니 공유-2a (sharing-plan §10, DEC-092): 반응·댓글·댓글 좋아요.
 * 소유자가 아닌 사용자가 쓰는 유일한 경로라, 볼 수 없는 기록에는 읽기·쓰기 모두 404 여야 한다.
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { COMMENT_MAX_LENGTH, COMMENT_MAX_PER_RECORD, todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');

describe('phase 4: sharing-2a (reactions, comments, likes)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
  const share = (who: Api, visibility: 'private' | 'friends') =>
    who.put('/me/sharing').send({ visibility }).expect(200);
  const rec = (ownerId: string, recordId: string) => `/friends/${ownerId}/meal-records/${recordId}`;
  const react = (who: Api, emoji: string, ownerId = aId, recordId = lunch) =>
    who.put(`${rec(ownerId, recordId)}/reaction`).send({ emoji });
  const comment = (who: Api, body: string, ownerId = aId, recordId = lunch) =>
    who.post(`${rec(ownerId, recordId)}/comments`).send({ body });
  const comments = (who: Api, ownerId = aId, recordId = lunch) =>
    who.get(`${rec(ownerId, recordId)}/comments`);
  /** A 의 오늘 점심을 식단 외 식사로 기록하고 기록 id 를 돌려준다 */
  const eatLunch = async (who: Api = a) =>
    (
      await who
        .put(`/meal-records/${TODAY}/lunch`)
        .send({ status: 'eaten', kind: 'outside', outsideMenu: '김치찌개', version: null })
        .expect(200)
    ).body.id as string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'social-a', '에이'));
    b = api(server, await login(server, 'social-b', '비'));
    c = api(server, await login(server, 'social-c', '씨'));
    d = api(server, await login(server, 'social-d', '디'));
    [aId, bId] = [await me(a), await me(b)];
  });

  afterAll(async () => {
    await app.close();
  });

  // A 는 공개, B·C 는 A 의 친구, D 는 남. A 의 오늘 점심 기록이 하나 있다
  beforeEach(async () => {
    await befriend(a, b);
    await befriend(a, c);
    await share(a, 'friends');
    lunch = await eatLunch();
  });

  afterEach(async () => {
    await prisma.friendLink.deleteMany({});
    await prisma.friendInvite.deleteMany({});
    await prisma.mealRecord.deleteMany({});
    await prisma.user.updateMany({ data: { shareVisibility: 'private', deletedAt: null } });
  });

  it('lets a friend react once per record; replacing and clearing; aggregates by emoji', async () => {
    expect((await react(b, '👍').expect(200)).body).toEqual({
      recordId: lunch,
      reactions: [{ emoji: '👍', count: 1 }],
      myReaction: '👍',
      commentCount: 0,
    });
    await react(c, '👍').expect(200);
    // 다시 보내면 교체: 행이 늘지 않는다
    const replaced = (await react(b, '❤️').expect(200)).body;
    expect(replaced.reactions).toEqual([
      { emoji: '👍', count: 1 },
      { emoji: '❤️', count: 1 },
    ]);
    expect(replaced.myReaction).toBe('❤️');
    expect(await prisma.mealReaction.count()).toBe(2);

    // 친구의 하루와 내 하루에 같은 집계가 실린다. 누가 눌렀는지는 없다
    const shared = (await c.get(`/friends/${aId}/days/${TODAY}`).expect(200)).body;
    const meal = shared.slots.find((s: { slot: string }) => s.slot === 'lunch');
    expect(meal.social).toEqual({ ...replaced, myReaction: '👍' });
    expect((await a.get(`/days/${TODAY}/social`).expect(200)).body).toEqual([
      { ...replaced, myReaction: null },
    ]);

    const cleared = (await b.delete(`${rec(aId, lunch)}/reaction`).expect(200)).body;
    expect(cleared).toMatchObject({ reactions: [{ emoji: '👍', count: 1 }], myReaction: null });
    // 없는 반응을 지워도 200
    await b.delete(`${rec(aId, lunch)}/reaction`).expect(200);
  });

  it('rejects reactions that are not allowed', async () => {
    await react(b, '👎').expect(422);
    await react(b, '').expect(422);
    // 기록 소유자는 자기 끼니에 반응하지 않는다
    await react(a, '👍').expect(404);
    // 남, 없는 기록, 다른 사람 경로에 끼운 기록: 모두 404
    await react(d, '👍').expect(404);
    await react(b, '👍', aId, randomUUID()).expect(404);
    await befriend(b, c);
    await share(b, 'friends');
    await react(c, '👍', bId, lunch).expect(404);
    expect(await prisma.mealReaction.count()).toBe(0);
  });

  it('lets friends and the owner comment; lists oldest first with flags', async () => {
    await comment(b, '  맛있겠다  ').expect(201);
    const afterOwner = (await comment(a, '고마워').expect(201)).body;
    expect(afterOwner.map((x: { body: string }) => x.body)).toEqual(['맛있겠다', '고마워']);

    const seenByC = (await comments(c).expect(200)).body;
    expect(seenByC).toMatchObject([
      { nickname: '비', userId: bId, mine: false, canDelete: false, likeCount: 0 },
      { nickname: '에이', userId: aId, mine: false, canDelete: false },
    ]);
    expect(Object.keys(seenByC[0]).sort()).toEqual(
      [
        'body',
        'canDelete',
        'createdAt',
        'id',
        'likeCount',
        'likedByMe',
        'mine',
        'nickname',
        'userId',
      ].sort(),
    );
    // 소유자는 전부 지울 수 있고, 쓴 사람은 자기 것만
    const seenByA = (await comments(a).expect(200)).body;
    expect(seenByA.map((x: { canDelete: boolean }) => x.canDelete)).toEqual([true, true]);
    const seenByB = (await comments(b).expect(200)).body;
    expect(
      seenByB.map((x: { mine: boolean; canDelete: boolean }) => [x.mine, x.canDelete]),
    ).toEqual([
      [true, true],
      [false, false],
    ]);
    expect((await b.get(`/friends/${aId}/days/${TODAY}`).expect(200)).body.slots[0].social).toEqual(
      expect.objectContaining({ commentCount: 2 }),
    );
  });

  it('validates comment length and hides comments from people who cannot see the record', async () => {
    await comment(b, 'x'.repeat(COMMENT_MAX_LENGTH)).expect(201);
    await comment(b, 'x'.repeat(COMMENT_MAX_LENGTH + 1)).expect(422);
    await comment(b, '   ').expect(422);
    await comment(b, undefined as unknown as string).expect(422);
    // 남은 읽지도 쓰지도 못한다
    await comments(d).expect(404);
    await comment(d, '안녕').expect(404);
    expect(await prisma.mealComment.count()).toBe(1);
  });

  it('deletes a comment only for its author or the record owner', async () => {
    const [first, second] = (
      await comment(b, '하나')
        .expect(201)
        .then(() => comment(b, '둘').expect(201))
    ).body as { id: string }[];
    // 다른 친구와 남은 404
    await c.delete(`${rec(aId, lunch)}/comments/${first!.id}`).expect(404);
    await d.delete(`${rec(aId, lunch)}/comments/${first!.id}`).expect(404);
    // 다른 기록 경로로는 지울 수 없다
    await b.delete(`${rec(aId, randomUUID())}/comments/${first!.id}`).expect(404);
    await b.delete(`${rec(aId, lunch)}/comments/${first!.id}`).expect(204);
    await a.delete(`${rec(aId, lunch)}/comments/${second!.id}`).expect(204);
    await a.delete(`${rec(aId, lunch)}/comments/${second!.id}`).expect(404);
    expect((await comments(b).expect(200)).body).toEqual([]);
  });

  it('likes a comment idempotently and only when the record is viewable', async () => {
    const id = ((await comment(b, '좋아요 받을 댓글').expect(201)).body as { id: string }[])[0]!.id;
    expect((await c.put(`/comments/${id}/like`).send({}).expect(200)).body).toEqual({
      likeCount: 1,
      likedByMe: true,
    });
    await c.put(`/comments/${id}/like`).send({}).expect(200);
    await a.put(`/comments/${id}/like`).send({}).expect(200);
    expect(await prisma.commentLike.count()).toBe(2);
    expect((await comments(c).expect(200)).body[0]).toMatchObject({
      likeCount: 2,
      likedByMe: true,
    });
    expect((await comments(b).expect(200)).body[0]).toMatchObject({
      likeCount: 2,
      likedByMe: false,
    });
    await d.put(`/comments/${id}/like`).send({}).expect(404);
    await c.put(`/comments/${randomUUID()}/like`).send({}).expect(404);
    expect((await c.delete(`/comments/${id}/like`).expect(200)).body).toEqual({
      likeCount: 1,
      likedByMe: false,
    });
    // 댓글이 지워지면 좋아요도 함께 지워진다
    await b.delete(`${rec(aId, lunch)}/comments/${id}`).expect(204);
    expect(await prisma.commentLike.count()).toBe(0);
  });

  it('closes everything the moment access is lost', async () => {
    await react(b, '🔥').expect(200);
    const id = (
      (await comment(b, '보이다가 안 보일 댓글').expect(201)).body as { id: string }[]
    )[0]!.id;
    // 비공개로 바꾸면 친구는 읽기·쓰기·좋아요·삭제 모두 404, 소유자는 그대로 본다
    await share(a, 'private');
    await react(b, '👍').expect(404);
    await b.delete(`${rec(aId, lunch)}/reaction`).expect(404);
    await comments(b).expect(404);
    await comment(b, '또').expect(404);
    await b.put(`/comments/${id}/like`).send({}).expect(404);
    await b.delete(`${rec(aId, lunch)}/comments/${id}`).expect(404);
    expect((await comments(a).expect(200)).body).toHaveLength(1);
    // 친구를 끊어도 같다
    await share(a, 'friends');
    await comments(b).expect(200);
    await a.delete(`/friends/${bId}`).expect(204);
    await comments(b).expect(404);
    await react(b, '👍').expect(404);
  });

  it('wipes reactions, comments and likes when the record goes back to unrecorded', async () => {
    await react(b, '😋').expect(200);
    const id = ((await comment(b, '사라질 댓글').expect(201)).body as { id: string }[])[0]!.id;
    await c.put(`/comments/${id}/like`).send({}).expect(200);
    // 안 먹음으로 바꾸는 것은 지우지 않는다
    const before = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    const skipped = (
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send({ status: 'skipped', version: before.version })
        .expect(200)
    ).body;
    expect((await comments(b).expect(200)).body).toHaveLength(1);

    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'unrecorded', version: skipped.version })
      .expect(200);
    expect(await prisma.mealReaction.count()).toBe(0);
    expect(await prisma.mealComment.count()).toBe(0);
    expect(await prisma.commentLike.count()).toBe(0);
    // 미기록 기록에는 달 수 없다
    await react(b, '👍').expect(404);
    await comment(b, '다시').expect(404);
    expect((await a.get(`/days/${TODAY}/social`).expect(200)).body).toEqual([]);
  });

  it('caps comments per record and removes a deleted extra record with its comments', async () => {
    await prisma.mealComment.createMany({
      data: Array.from({ length: COMMENT_MAX_PER_RECORD }, (_, i) => ({
        mealRecordId: lunch,
        userId: bId,
        body: `c${i}`,
      })),
    });
    const res = await comment(b, '101번째').expect(422);
    expect(res.body.code).toBe('COMMENT_LIMIT');
    expect((await comments(b).expect(200)).body).toHaveLength(COMMENT_MAX_PER_RECORD);

    const extra = (
      await a
        .post(`/meal-records/${TODAY}/extra`)
        .send({ status: 'eaten', kind: 'outside', outsideMenu: '붕어빵' })
        .expect(201)
    ).body.id as string;
    await comment(b, '간식 댓글', aId, extra).expect(201);
    await react(b, '👏', aId, extra).expect(200);
    await a.delete(`/meal-records/${TODAY}/extra/${extra}`).expect(204);
    expect(await prisma.mealComment.count({ where: { mealRecordId: extra } })).toBe(0);
    expect(await prisma.mealReaction.count()).toBe(0);
  });

  it('requires login', async () => {
    const anon = request(app.getHttpServer() as Parameters<typeof request>[0]);
    await anon.get(`/api/v1${rec(aId, lunch)}/comments`).expect(401);
    await anon.get(`/api/v1/days/${TODAY}/social`).expect(401);
  });
});
