/**
 * 끼니 공유-1a (sharing-plan §10, DEC-066·090): 초대 링크로 친구 맺기, 공개 범위, 친구의 하루.
 * 격리가 먼저다: 볼 수 없는 모든 경우가 같은 404 이고, 응답에 공유하지 않는 필드가 없다.
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import request from 'supertest';
import sharp from 'sharp';
import { FRIEND_INVITE_MAX_ACTIVE, todayIn } from '@diet/shared';
import { addDays, isoWeekday } from '../src/domain/dates';
import { PhotosService } from '../src/photos/photos.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WEB, api, createApp, login, testEnv } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const WEEKDAY = isoWeekday(TODAY);

describe('phase 4: sharing-1a', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let c: ReturnType<typeof api>;
  let aId: string;
  let bId: string;
  let cId: string;
  /** 가입일을 당기는 테스트가 다음 테스트로 새지 않게 되돌린다 */
  let aCreatedAt: Date;

  const me = async (who: ReturnType<typeof api>) => (await who.get('/me').expect(200)).body.id;
  const invite = async (who: ReturnType<typeof api>) =>
    (await who.post('/friend-invites').send({}).expect(201)).body as {
      id: string;
      code: string;
      url: string;
    };
  /** from 이 만든 링크를 to 가 수락한다 */
  const befriend = async (from: ReturnType<typeof api>, to: ReturnType<typeof api>) => {
    const { code } = await invite(from);
    await to.post(`/friend-invites/${code}/accept`).send({}).expect(200);
  };
  const share = (who: ReturnType<typeof api>, visibility: 'private' | 'friends') =>
    who.put('/me/sharing').send({ visibility }).expect(200);
  const day = (who: ReturnType<typeof api>, ownerId: string, date = TODAY) =>
    who.get(`/friends/${ownerId}/days/${date}`);

  beforeAll(async () => {
    rmSync(testEnv.photosDir, { recursive: true, force: true });
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'share-a', '에이'));
    b = api(server, await login(server, 'share-b', '비'));
    c = api(server, await login(server, 'share-c', '씨'));
    [aId, bId, cId] = [await me(a), await me(b), await me(c)];
    aCreatedAt = (await prisma.user.findUniqueOrThrow({ where: { id: aId } })).createdAt;
  });

  afterAll(async () => {
    await app.close();
    rmSync(testEnv.photosDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    app.get(PhotosService).resetUploadCounts();
    await prisma.friendLink.deleteMany({});
    await prisma.friendInvite.deleteMany({});
    await prisma.mealPhoto.deleteMany({});
    await prisma.mealRecord.deleteMany({});
    await prisma.weightRecord.deleteMany({});
    await prisma.user.updateMany({
      data: { shareVisibility: 'private', shareWeight: false, deletedAt: null },
    });
    await prisma.user.update({ where: { id: aId }, data: { createdAt: aCreatedAt } });
  });

  it('is private by default and hides non-friends behind the same 404', async () => {
    expect((await a.get('/me/sharing').expect(200)).body).toEqual({
      visibility: 'private',
      shareWeight: false,
    });
    // 친구가 아님, 없는 사용자, 자기 자신, UUID 가 아닌 값: 모두 같은 404
    const bodies = [
      (await day(b, aId).expect(404)).body,
      (await day(b, randomUUID()).expect(404)).body,
      (await day(a, aId).expect(404)).body,
      (await day(b, 'not-a-uuid').expect(404)).body,
    ];
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    // 공개로 바꿔도 친구가 아니면 볼 수 없다
    await share(a, 'friends');
    await day(b, aId).expect(404);
    expect((await b.get('/friends').expect(200)).body).toEqual([]);
  });

  it('makes friends through an invite link; visibility is one-directional', async () => {
    const inv = await invite(a);
    expect(inv.url).toBe(`${WEB}/invite/${inv.code}`);
    expect(inv.code.length).toBeGreaterThanOrEqual(16);
    // 미리보기는 로그인 없이, 닉네임만
    const preview = await request(server).get(`/api/v1/friend-invites/${inv.code}`).expect(200);
    expect(preview.body).toEqual({ nickname: '에이' });

    const accepted = await b.post(`/friend-invites/${inv.code}/accept`).send({}).expect(200);
    expect(accepted.body).toMatchObject({ userId: aId, nickname: '에이', shared: false });

    // 친구가 됐지만 둘 다 비공개: 목록에는 보이고 하루는 404
    const listB = (await b.get('/friends').expect(200)).body;
    expect(listB).toHaveLength(1);
    expect(listB[0]).toMatchObject({ userId: aId, shared: false, today: null });
    await day(b, aId).expect(404);
    await day(a, bId).expect(404);

    // A 만 공개: B 는 A 를 보고, A 는 B 를 보지 못한다
    await share(a, 'friends');
    await day(b, aId).expect(200);
    await day(a, bId).expect(404);
    const friendA = (await b.get('/friends').expect(200)).body[0];
    expect(friendA.shared).toBe(true);
    expect(friendA.today).toEqual({
      date: TODAY,
      activeSlots: 0,
      recordedSlots: 0,
      completed: false,
    });
    expect((await a.get('/friends').expect(200)).body[0]).toMatchObject({
      userId: bId,
      shared: false,
      today: null,
    });

    // 다시 비공개로: 즉시 404
    await share(a, 'private');
    await day(b, aId).expect(404);
  });

  it('turns sharing off for one friend only', async () => {
    await befriend(a, b);
    await befriend(a, c);
    await share(a, 'friends');
    await day(b, aId).expect(200);
    await day(c, aId).expect(200);

    const off = await a.patch(`/friends/${bId}`).send({ shareToFriend: false }).expect(200);
    expect(off.body).toMatchObject({ userId: bId, shareToFriend: false });
    await day(b, aId).expect(404);
    await day(c, aId).expect(200);
    // 상대 쪽 스위치는 그대로다
    expect((await b.get('/friends').expect(200)).body[0]).toMatchObject({
      userId: aId,
      shareToFriend: true,
      shared: false,
    });

    await a.patch(`/friends/${bId}`).send({ shareToFriend: true }).expect(200);
    await day(b, aId).expect(200);
    // 친구가 아닌 상대의 스위치는 404
    await b.patch(`/friends/${cId}`).send({ shareToFriend: false }).expect(404);
    await a.patch(`/friends/${bId}`).send({}).expect(422);
  });

  it('rejects used, expired, revoked, own and malformed invite links', async () => {
    // 1회용: 두 번째 수락은 404
    const used = await invite(a);
    await b.post(`/friend-invites/${used.code}/accept`).send({}).expect(200);
    await c.post(`/friend-invites/${used.code}/accept`).send({}).expect(404);
    await request(server).get(`/api/v1/friend-invites/${used.code}`).expect(404);
    expect((await a.get('/friend-invites').expect(200)).body).toEqual([]);

    // 이미 친구: 422, 링크는 쓰이지 않는다
    const again = await invite(a);
    const dup = await b.post(`/friend-invites/${again.code}/accept`).send({}).expect(422);
    expect(dup.body.code).toBe('FRIEND_ALREADY');
    // 자기 링크: 422
    const own = await a.post(`/friend-invites/${again.code}/accept`).send({}).expect(422);
    expect(own.body.code).toBe('FRIEND_INVITE_OWN');
    expect((await a.get('/friend-invites').expect(200)).body).toHaveLength(1);

    // 만료
    await prisma.friendInvite.update({
      where: { id: again.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await c.post(`/friend-invites/${again.code}/accept`).send({}).expect(404);

    // 철회: 남의 링크는 철회할 수 없다(404)
    const revoked = await invite(a);
    await b.delete(`/friend-invites/${revoked.id}`).expect(404);
    await a.delete(`/friend-invites/${revoked.id}`).expect(204);
    await a.delete(`/friend-invites/${revoked.id}`).expect(404);
    await c.post(`/friend-invites/${revoked.code}/accept`).send({}).expect(404);

    // 형식이 아닌 코드, 없는 코드
    await c.post('/friend-invites/short/accept').send({}).expect(404);
    await c.post('/friend-invites/AAAAAAAAAAAAAAAAAAAA/accept').send({}).expect(404);
    // 로그인 없이 수락할 수 없다
    const fresh = await invite(a);
    await request(server)
      .post(`/api/v1/friend-invites/${fresh.code}/accept`)
      .set('Origin', WEB)
      .send({})
      .expect(401);
  });

  it('limits active invites and lets only one of two concurrent accepts through', async () => {
    for (let i = 0; i < FRIEND_INVITE_MAX_ACTIVE; i++) await invite(a);
    const over = await a.post('/friend-invites').send({}).expect(422);
    expect(over.body.code).toBe('FRIEND_INVITE_LIMIT');

    const [first] = (await a.get('/friend-invites').expect(200)).body;
    const results = await Promise.all([
      b.post(`/friend-invites/${first.code}/accept`).send({}),
      c.post(`/friend-invites/${first.code}/accept`).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await prisma.friendLink.count()).toBe(1);
  });

  it('cuts access for both sides on unfriend and for deleted accounts', async () => {
    await befriend(a, b);
    await share(a, 'friends');
    await share(b, 'friends');
    await day(a, bId).expect(200);
    await day(b, aId).expect(200);

    // 제3자는 끊을 수 없다
    await c.delete(`/friends/${aId}`).expect(404);
    await b.delete(`/friends/${aId}`).expect(204);
    await day(a, bId).expect(404);
    await day(b, aId).expect(404);
    expect((await a.get('/friends').expect(200)).body).toEqual([]);
    await b.delete(`/friends/${aId}`).expect(404);

    // 탈퇴한 친구는 목록에서 빠지고 볼 수 없다. 탈퇴한 사람의 링크도 쓸 수 없다
    await befriend(a, c);
    const stale = await invite(a);
    await prisma.user.update({ where: { id: aId }, data: { deletedAt: new Date() } });
    expect((await c.get('/friends').expect(200)).body).toEqual([]);
    await day(c, aId).expect(404);
    await b.post(`/friend-invites/${stale.code}/accept`).send({}).expect(404);
    await request(server).get(`/api/v1/friend-invites/${stale.code}`).expect(404);
  });

  it('shares only whitelisted fields of a day (SharedDayDto key snapshot)', async () => {
    // A: 닭가슴살 식단을 오늘 아침·점심에, 체중·목표·구매도 넣어 둔다(새면 안 되는 것들)
    const chicken = (
      await a
        .post('/products')
        .send({
          name: '닭가슴살',
          stockUnit: 'ea',
          unitLabel: '팩',
          unitsPerPackage: 1,
          packWeightG: 100,
        })
        .expect(201)
    ).body.id;
    await a
      .post(`/products/${chicken}/nutrition`)
      .send({
        basisAmount: 100,
        basisUnit: 'g',
        kcal: 118,
        proteinG: 25,
        carbG: 0,
        fatG: 2,
        source: 'label',
      })
      .expect(201);
    const template = (
      await a
        .post('/meal-templates')
        .send({ name: '비밀 식단 이름', items: [{ productId: chicken, quantity: 200, unit: 'g' }] })
        .expect(201)
    ).body.id;
    for (const slot of ['breakfast', 'lunch']) {
      await a
        .put(`/plans/weekly/${WEEKDAY}/${slot}`)
        .send({ planType: 'template', templateId: template })
        .expect(200);
    }
    // 아침: 먹었음(내 식품), 점심: 미기록(식단 끼니), 저녁: 식단 외 식사(영양 미상), 간식: 안 먹음
    await a
      .put(`/meal-records/${TODAY}/breakfast`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 2, unit: 'ea' }],
        version: null,
      })
      .expect(200);
    const photo = (
      await a
        .post('/meal-photos')
        .attach(
          'file',
          await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
            .png()
            .toBuffer(),
          'meal.png',
        )
        .expect(201)
    ).body.id;
    await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send({
        status: 'eaten',
        kind: 'outside',
        outsideMenu: '김치찌개',
        photoIds: [photo],
        version: null,
      })
      .expect(200);
    await a
      .put(`/meal-records/${TODAY}/evening_snack`)
      .send({ status: 'skipped', version: null })
      .expect(200);
    await a
      .post(`/meal-records/${TODAY}/extra`)
      .send({ status: 'eaten', kind: 'outside', outsideMenu: '붕어빵', outsideKcal: 200 })
      .expect(201);
    await a.put(`/weights/${TODAY}`).send({ weightKg: 71.35 }).expect(200);

    await befriend(a, b);
    await share(a, 'friends');
    const res = await day(b, aId).expect(200);
    const body = res.body;

    expect(Object.keys(body).sort()).toEqual(
      [
        'completed',
        'date',
        'extras',
        'firstDate',
        'nutrition',
        'owner',
        'slots',
        'today',
        'weight',
      ].sort(),
    );
    // 몸무게는 켜지 않으면 null 이다 (DEC-101)
    expect(body.weight).toBeNull();
    expect(body.owner).toEqual({ userId: aId, nickname: '에이' });
    expect(body).toMatchObject({ date: TODAY, today: TODAY, firstDate: TODAY, completed: false });
    for (const meal of [...body.slots, ...body.extras]) {
      expect(Object.keys(meal).sort()).toEqual(
        ['items', 'kind', 'outsideMenu', 'photos', 'recordId', 'slot', 'social', 'status'].sort(),
      );
    }
    // 미기록 자유 끼니(오후 간식)는 없다 (D-18). 미기록 식단 끼니(점심)는 상태만 보인다
    expect(body.slots.map((s: { slot: string }) => s.slot)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'evening_snack',
    ]);
    const [breakfast, lunch, dinner, snack] = body.slots;
    expect(breakfast).toMatchObject({ status: 'eaten', kind: 'home', outsideMenu: null });
    expect(breakfast.items).toEqual([
      { name: '닭가슴살', quantity: 2, unit: 'ea', displayUnit: '팩' },
    ]);
    // 계획 품목과 식단 이름은 공유하지 않는다
    expect(lunch).toMatchObject({ status: 'unrecorded', recordId: null, items: [], photos: [] });
    expect(dinner).toMatchObject({ status: 'eaten', kind: 'outside', outsideMenu: '김치찌개' });
    expect(dinner.photos).toHaveLength(1);
    expect(Object.keys(dinner.photos[0]).sort()).toEqual(['expired', 'height', 'id', 'width']);
    expect(snack).toMatchObject({ status: 'skipped', items: [] });
    expect(body.extras).toHaveLength(1);
    expect(body.extras[0]).toMatchObject({ slot: 'extra', outsideMenu: '붕어빵' });

    // 영양 합계: 닭 2팩(236) + 붕어빵 200, 김치찌개는 미상 → complete=false (null 은 미상)
    expect(Object.keys(body.nutrition).sort()).toEqual(
      ['carbG', 'complete', 'fatG', 'kcal', 'missing', 'proteinG'].sort(),
    );
    expect(body.nutrition).toMatchObject({ kcal: 436, complete: false, missing: 1 });

    // 응답 어디에도 식단 이름·재고·체중·목표·카카오 ID·제품 id 가 없다
    const text = JSON.stringify(body);
    for (const leaked of ['비밀 식단 이름', 'share-a', chicken, template, '71.35']) {
      expect(text).not.toContain(leaked);
    }
    for (const key of [
      'weightkg',
      'goal',
      'target',
      'stock',
      'kakao',
      'template',
      'plan',
      'version',
    ]) {
      expect(text.toLowerCase()).not.toContain(key);
    }

    // 하루 완료가 보인다
    await a.put(`/meal-records/${TODAY}/lunch`).send({ status: 'skipped', version: null });
    await a.put(`/days/${TODAY}/completion`).send({}).expect(200);
    expect((await day(b, aId).expect(200)).body.completed).toBe(true);
    expect((await b.get('/friends').expect(200)).body[0].today).toEqual({
      date: TODAY,
      activeSlots: 4,
      recordedSlots: 4,
      completed: true,
    });
  });

  it('shows days from signup to today only', async () => {
    await befriend(a, b);
    await share(a, 'friends');
    await day(b, aId, TODAY).expect(200);
    await day(b, aId, addDays(TODAY, 1)).expect(404);
    // A 는 오늘 가입했다: 어제는 가입 전
    await day(b, aId, addDays(TODAY, -1)).expect(404);
    await day(b, aId, 'not-a-date').expect(422);
    // 가입일을 당기면 그날부터 보인다
    await prisma.user.update({
      where: { id: aId },
      data: { createdAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const past = await day(b, aId, addDays(TODAY, -3)).expect(200);
    expect(past.body.firstDate).toBe(addDays(TODAY, -3));
    await day(b, aId, addDays(TODAY, -4)).expect(404);
  });

  it('shares weight only when both the global and the per-friend switch are on', async () => {
    const shareWeight = (who: ReturnType<typeof api>, on: boolean) =>
      who.put('/me/sharing').send({ visibility: 'friends', shareWeight: on }).expect(200);
    const toFriend = (who: ReturnType<typeof api>, id: string, on: boolean) =>
      who.patch(`/friends/${id}`).send({ shareWeightToFriend: on }).expect(200);
    const weight = async (who: ReturnType<typeof api>, date = TODAY) =>
      (await day(who, aId, date).expect(200)).body.weight;

    // A 는 6일 전 가입, 목표 체중도 있다(새면 안 된다)
    await prisma.user.update({
      where: { id: aId },
      data: { createdAt: new Date(Date.now() - 6 * 86_400_000) },
    });
    await a
      .put(`/weights/${addDays(TODAY, -2)}`)
      .send({ weightKg: 72.4 })
      .expect(200);
    await a.put(`/weights/${TODAY}`).send({ weightKg: 71.9 }).expect(200);
    await befriend(a, b);
    await befriend(a, c);
    await share(a, 'friends');

    // 새 친구는 꺼진 채로 시작한다. visibility 만 보내면 shareWeight 는 그대로다
    expect((await a.get('/friends').expect(200)).body[0].shareWeightToFriend).toBe(false);
    expect(await weight(b)).toBeNull();
    // 전체만 켬 → null
    expect((await shareWeight(a, true)).body).toEqual({ visibility: 'friends', shareWeight: true });
    expect((await share(a, 'friends')).body.shareWeight).toBe(true);
    expect(await weight(b)).toBeNull();
    // 친구별만 켬 → null
    await shareWeight(a, false);
    const on = await toFriend(a, bId, true);
    expect(on.body).toMatchObject({ userId: bId, shareToFriend: true, shareWeightToFriend: true });
    expect(await weight(b)).toBeNull();

    // 둘 다 켬 → B 에게만 보인다. 7일(그날 포함), 기록 없는 날은 null
    await shareWeight(a, true);
    const w = await weight(b);
    expect(Object.keys(w).sort()).toEqual(['recent', 'weightKg']);
    expect(w.weightKg).toBe(71.9);
    expect(w.recent).toHaveLength(7);
    expect(w.recent[0]).toEqual({ date: addDays(TODAY, -6), weightKg: null });
    expect(w.recent[4]).toEqual({ date: addDays(TODAY, -2), weightKg: 72.4 });
    expect(w.recent[6]).toEqual({ date: TODAY, weightKg: 71.9 });
    expect(await weight(c)).toBeNull();
    // 목표 체중은 어디에도 없다
    const text = JSON.stringify((await day(b, aId).expect(200)).body).toLowerCase();
    expect(text).not.toContain('target');
    expect(text).not.toContain('goal');

    // 기록 없는 날: 값은 null, 창은 가입일에서 잘린다
    const past = await weight(b, addDays(TODAY, -3));
    expect(past.weightKg).toBeNull();
    expect(past.recent.map((p: { date: string }) => p.date)).toEqual([
      addDays(TODAY, -6),
      addDays(TODAY, -5),
      addDays(TODAY, -4),
      addDays(TODAY, -3),
    ]);
    expect(past.recent.every((p: { weightKg: number | null }) => p.weightKg === null)).toBe(true);

    // 상대 쪽 스위치는 따로다: B 가 A 에게 켠 것이 아니다
    expect((await b.get('/friends').expect(200)).body[0]).toMatchObject({
      userId: aId,
      shareWeightToFriend: false,
    });
    // 끼니를 끄면 하루 자체가 404
    await a.patch(`/friends/${bId}`).send({ shareToFriend: false }).expect(200);
    await day(b, aId).expect(404);
    // 끼니를 끄면 몸무게 스위치도 꺼진다: 끼니만 다시 켜도 몸무게는 따라 켜지지 않는다
    const back = await a.patch(`/friends/${bId}`).send({ shareToFriend: true }).expect(200);
    expect(back.body.shareWeightToFriend).toBe(false);
    expect(await weight(b)).toBeNull();
    await toFriend(a, bId, true);
    expect((await weight(b)).weightKg).toBe(71.9);
    // 몸무게만 따로 바꿀 수 있고 공개 범위는 그대로다
    expect((await a.put('/me/sharing').send({ shareWeight: true }).expect(200)).body).toEqual({
      visibility: 'friends',
      shareWeight: true,
    });
    // null 은 '그대로' 가 아니라 잘못된 값이다
    await a.patch(`/friends/${bId}`).send({ shareWeightToFriend: null }).expect(422);
    await a.put('/me/sharing').send({ shareWeight: null }).expect(422);
    await a.put('/me/sharing').send({ visibility: 'friends', shareWeight: null }).expect(422);

    // 친구를 끊고 다시 맺으면 꺼진 채로 돌아온다
    await a.delete(`/friends/${bId}`).expect(204);
    await befriend(a, b);
    expect(await weight(b)).toBeNull();
    // 친구가 아닌 상대, 잘못된 값
    await b.patch(`/friends/${cId}`).send({ shareWeightToFriend: true }).expect(404);
    await a.patch(`/friends/${bId}`).send({ shareWeightToFriend: 'yes' }).expect(422);
    await a.put('/me/sharing').send({ visibility: 'friends', shareWeight: 'yes' }).expect(422);
  });

  it('serves a friend only photos attached to a record, and only while viewable', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const up = async (who: ReturnType<typeof api>) =>
      (await who.post('/meal-photos').attach('file', png, 'meal.png').expect(201)).body.id;
    const attached = await up(a);
    const draft = await up(a);
    const cPhoto = await up(c);
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        kind: 'outside',
        outsideMenu: '김밥',
        photoIds: [attached],
        version: null,
      })
      .expect(200);
    const file = (who: ReturnType<typeof api>, ownerId: string, id: string) =>
      who.get(`/friends/${ownerId}/meal-photos/${id}`);

    // 친구가 아니면 404
    await file(b, aId, attached).expect(404);
    await befriend(a, b);
    // 친구지만 비공개면 404
    await file(b, aId, attached).expect(404);
    await share(a, 'friends');

    const ok = await file(b, aId, attached).expect(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toBe('private, no-cache');
    await b.get(`/friends/${aId}/meal-photos/${attached}?size=thumb`).expect(200);
    // 저장 전 임시 사진은 보이지 않는다
    await file(b, aId, draft).expect(404);
    // 볼 수 있는 친구의 경로로 남의 사진을 꺼낼 수 없다
    await file(b, aId, cPhoto).expect(404);
    // 본인용 경로로는 친구의 사진을 받을 수 없다(격리 그대로)
    await b.get(`/meal-photos/${attached}`).expect(404);
    // 친구는 지울 수 없다
    await b.delete(`/meal-photos/${attached}`).expect(404);
    // 제3자는 볼 수 없다
    await file(c, aId, attached).expect(404);

    // 기록을 취소하면 사진도 사라진다
    const rec = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'unrecorded', version: rec.version })
      .expect(200);
    await file(b, aId, attached).expect(404);
  });

  it('requires a valid visibility value and a session', async () => {
    await a.put('/me/sharing').send({ visibility: 'public' }).expect(422);
    await a.put('/me/sharing').send({}).expect(422);
    await request(server).get('/api/v1/friends').expect(401);
    await request(server).get(`/api/v1/friends/${aId}/days/${TODAY}`).expect(401);
    await request(server).get('/api/v1/me/sharing').expect(401);
  });
});
