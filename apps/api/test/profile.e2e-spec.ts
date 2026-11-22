/**
 * 프로필: 닉네임·상태 메시지·프로필 사진 (DEC-104).
 * 격리 우선: 프로필과 사진 파일은 본인·친구·같은 친구가 있는 사람에게만 보이고 그 밖은 404.
 * 저장은 요청 하나, 사진은 만료 없이 남고 식사 사진 정리가 건드리지 않는다.
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import {
  AVATAR_MAX_CHANGES_PER_DAY,
  AVATAR_THUMB_PX,
  AVATAR_VIEW_PX,
  NICKNAME_MAX_LENGTH,
  STATUS_MESSAGE_MAX_LENGTH,
  todayIn,
} from '@diet/shared';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { ProfileService } from '../src/profile/profile.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login, testEnv } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const DIR = testEnv.photosDir;

describe('profile (DEC-104)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  type Api = ReturnType<typeof api>;
  let a: Api;
  let b: Api;
  let c: Api;
  let d: Api;
  let e: Api;
  let aId: string;
  let bId: string;
  let cId: string;
  let eId: string;
  let jpeg: Buffer;

  const me = async (who: Api) => (await who.get('/me').expect(200)).body;
  const befriend = async (from: Api, to: Api) => {
    const { code } = (await from.post('/friend-invites').send({}).expect(201)).body;
    await to.post(`/friend-invites/${code}/accept`).send({}).expect(200);
  };
  const save = (
    who: Api,
    fields: { nickname?: string; statusMessage?: string; removeAvatar?: boolean },
    file?: Buffer,
  ) => {
    let req = who.put('/me/profile');
    // 글자 필드만 있을 때도 multipart 로 보낸다
    req = req.field('nickname', fields.nickname ?? 'A');
    if (fields.statusMessage !== undefined) req = req.field('statusMessage', fields.statusMessage);
    if (fields.removeAvatar !== undefined) {
      req = req.field('removeAvatar', String(fields.removeAvatar));
    }
    return file ? req.attach('file', file, 'me.jpg') : req;
  };
  const avatarFiles = (userId: string): string[] => {
    const dir = join(DIR, userId, 'avatar');
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };
  const binary = (who: Api, path: string) =>
    who
      .get(path)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    ({ app, prisma } = await createApp());
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'profile-a', 'A'));
    b = api(server, await login(server, 'profile-b', 'B'));
    c = api(server, await login(server, 'profile-c', 'C'));
    d = api(server, await login(server, 'profile-d', 'D'));
    e = api(server, await login(server, 'profile-e', 'E'));
    aId = (await me(a)).id;
    bId = (await me(b)).id;
    cId = (await me(c)).id;
    eId = (await me(e)).id;
    // A—B, B—C, A—E. C 는 A 와 '같은 친구(B)' 사이, D 는 남
    await befriend(a, b);
    await befriend(b, c);
    await befriend(a, e);
    // 휴대폰 사진 흉내: 3000×2000, 위치 정보 포함
    jpeg = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#4488cc' },
    })
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
  });

  afterAll(async () => {
    await app.close();
    rmSync(DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    app.get(ProfileService).resetChangeCounts();
  });

  it('처음에는 사진·상태 메시지가 없다', async () => {
    expect(await me(a)).toMatchObject({ nickname: 'A', statusMessage: null, avatarId: null });
    await a.get(`/profiles/${aId}/avatar`).expect(404);
  });

  it('요청 하나로 닉네임·상태 메시지·사진을 함께 저장한다', async () => {
    const res = await save(a, { nickname: '  에이  ', statusMessage: '오늘도\n 꾸준히 ' }, jpeg);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nickname: '에이', statusMessage: '오늘도 꾸준히' });
    expect(res.body.avatarId).toEqual(expect.any(String));
    expect(avatarFiles(aId)).toEqual([`${res.body.avatarId}.jpg`, `${res.body.avatarId}_t.jpg`]);
  });

  it('보기용은 긴 변 800, 썸네일은 정사각 160 이고 EXIF 가 없다', async () => {
    const view = await binary(a, `/profiles/${aId}/avatar`).expect(200);
    expect(view.headers['content-type']).toBe('image/jpeg');
    expect(view.headers['cache-control']).toBe('private, no-cache');
    const vm = await sharp(view.body as Buffer).metadata();
    expect([vm.width, vm.height]).toEqual([AVATAR_VIEW_PX, Math.round((AVATAR_VIEW_PX * 2) / 3)]);
    expect(vm.exif).toBeUndefined();
    const thumb = await binary(a, `/profiles/${aId}/avatar?size=thumb`).expect(200);
    const tm = await sharp(thumb.body as Buffer).metadata();
    expect([tm.width, tm.height]).toEqual([AVATAR_THUMB_PX, AVATAR_THUMB_PX]);
    // 그대로면 304
    await a
      .get(`/profiles/${aId}/avatar`)
      .set('If-None-Match', view.headers['etag'] as string)
      .expect(304);
  });

  it('file 이 없으면 사진은 그대로, 상태 메시지를 비우면 지운다', async () => {
    const before = (await me(a)).avatarId;
    const res = await save(a, { nickname: 'A', statusMessage: '' }).expect(200);
    expect(res.body).toMatchObject({ nickname: 'A', statusMessage: null, avatarId: before });
    const again = await save(a, { nickname: 'A' }).expect(200);
    expect(again.body.avatarId).toBe(before);
  });

  it('검증: 닉네임 필수·길이, 상태 메시지 길이', async () => {
    await a.put('/me/profile').field('statusMessage', 'x').expect(422);
    await save(a, { nickname: '   ' }).expect(422);
    await save(a, { nickname: 'x'.repeat(NICKNAME_MAX_LENGTH + 1) }).expect(422);
    await save(a, { statusMessage: 'x'.repeat(STATUS_MESSAGE_MAX_LENGTH + 1) }).expect(422);
    await save(a, { statusMessage: 'x'.repeat(STATUS_MESSAGE_MAX_LENGTH) }).expect(200);
    await save(a, { statusMessage: '꾸준히' }).expect(200);
  });

  it('읽을 수 없는 파일이면 아무것도 바뀌지 않는다', async () => {
    const before = await me(a);
    const res = await save(a, { nickname: '바뀌면안됨' }, Buffer.from('not an image'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PHOTO_UNSUPPORTED');
    expect(await me(a)).toEqual(before);
    expect(avatarFiles(aId)).toHaveLength(2);
  });

  describe('누가 볼 수 있는가', () => {
    it('본인·친구·같은 친구가 있는 사람은 프로필과 사진을 본다', async () => {
      expect((await a.get(`/profiles/${aId}`).expect(200)).body).toMatchObject({
        userId: aId,
        nickname: 'A',
        statusMessage: '꾸준히',
        isMe: true,
        isFriend: false,
      });
      expect((await b.get(`/profiles/${aId}`).expect(200)).body).toMatchObject({
        isMe: false,
        isFriend: true,
      });
      const viaCommon = (await c.get(`/profiles/${aId}`).expect(200)).body;
      expect(viaCommon).toMatchObject({ isMe: false, isFriend: false });
      // 화이트리스트: 이 필드만 나간다
      expect(Object.keys(viaCommon).sort()).toEqual(
        ['avatarId', 'isFriend', 'isMe', 'nickname', 'statusMessage', 'userId'].sort(),
      );
      await b.get(`/profiles/${aId}/avatar?size=thumb`).expect(200);
      await c.get(`/profiles/${aId}/avatar?size=thumb`).expect(200);
    });

    it('끼니 공개 범위와 무관하다(A 는 비공개)', async () => {
      expect((await a.get('/me/sharing').expect(200)).body.visibility).toBe('private');
      await b.get(`/friends/${aId}/days/${TODAY}`).expect(404);
      await b.get(`/profiles/${aId}`).expect(200);
    });

    it('남·없는 사용자·잘못된 id 는 모두 404', async () => {
      await d.get(`/profiles/${aId}`).expect(404);
      await d.get(`/profiles/${aId}/avatar`).expect(404);
      await a.get(`/profiles/${randomUUID()}`).expect(404);
      await a.get('/profiles/not-a-uuid').expect(404);
      // 사진이 없는 친구
      await a.get(`/profiles/${bId}/avatar`).expect(404);
    });

    it('친구 목록·댓글·친구의 하루에 avatarId 가 실린다', async () => {
      const friends = (await b.get('/friends').expect(200)).body as {
        userId: string;
        avatarId: string | null;
        statusMessage: string | null;
      }[];
      const meAsFriend = friends.find((f) => f.userId === aId)!;
      expect(meAsFriend.avatarId).toBe((await me(a)).avatarId);
      expect(meAsFriend.statusMessage).toBe('꾸준히');

      // B 가 끼니를 공개하고 점심을 기록 → A 가 댓글 → C 가 댓글 목록에서 A 의 사진 id 를 본다
      await b.put('/me/sharing').send({ visibility: 'friends' }).expect(200);
      const lunch = (
        await b
          .put(`/meal-records/${TODAY}/lunch`)
          .send({
            status: 'eaten',
            kind: 'outside',
            outsideItems: [{ name: '김치찌개' }],
            version: null,
          })
          .expect(200)
      ).body.id as string;
      await a.post(`/friends/${bId}/meal-records/${lunch}/comments`).send({ body: '맛있겠다' });
      const list = (await c.get(`/friends/${bId}/meal-records/${lunch}/comments`).expect(200))
        .body as { userId: string; avatarId: string | null }[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ userId: aId, avatarId: (await me(a)).avatarId });
      const day = (await a.get(`/friends/${bId}/days/${TODAY}`).expect(200)).body;
      expect(day.owner).toEqual({ userId: bId, nickname: 'B', avatarId: null });
    });

    it('차단하면 서로 404, 친구를 끊으면 같은 친구가 없을 때 404', async () => {
      await e.get(`/profiles/${aId}`).expect(200);
      await a.post(`/friends/${eId}/block`).send({}).expect(204);
      await e.get(`/profiles/${aId}`).expect(404);
      await e.get(`/profiles/${aId}/avatar`).expect(404);
      await a.get(`/profiles/${eId}`).expect(404);

      // B—C 를 끊으면 C 와 A 사이에 같은 친구가 없다
      await b.delete(`/friends/${cId}`).expect(204);
      await c.get(`/profiles/${aId}`).expect(404);
      await c.get(`/profiles/${aId}/avatar`).expect(404);
      await befriend(b, c);
      await c.get(`/profiles/${aId}`).expect(200);
    });

    it('탈퇴한 사용자의 프로필은 404', async () => {
      await prisma.user.update({ where: { id: cId }, data: { deletedAt: new Date() } });
      await b.get(`/profiles/${cId}`).expect(404);
      await prisma.user.update({ where: { id: cId }, data: { deletedAt: null } });
      await b.get(`/profiles/${cId}`).expect(200);
    });
  });

  it('사진을 바꾸면 옛 파일이 지워지고 ETag 가 바뀐다', async () => {
    const before = (await me(a)).avatarId as string;
    const etag = (await a.get(`/profiles/${aId}/avatar`).expect(200)).headers['etag'] as string;
    const res = await save(a, { statusMessage: '꾸준히' }, jpeg).expect(200);
    expect(res.body.avatarId).not.toBe(before);
    expect(avatarFiles(aId)).toEqual([`${res.body.avatarId}.jpg`, `${res.body.avatarId}_t.jpg`]);
    await a.get(`/profiles/${aId}/avatar`).set('If-None-Match', etag).expect(200);
  });

  it('매일 정리: 식사 사진 정리는 프로필 사진을 지우지 않고, 안 쓰는 프로필 파일만 지운다', async () => {
    const current = (await me(a)).avatarId as string;
    const dir = join(DIR, aId, 'avatar');
    const stale = randomUUID();
    const fresh = randomUUID();
    writeFileSync(join(dir, `${stale}.jpg`), 'x');
    writeFileSync(join(dir, `${stale}_t.jpg`), 'x');
    writeFileSync(join(dir, `${fresh}.jpg`), 'x');
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(join(dir, `${stale}.jpg`), old, old);
    utimesSync(join(dir, `${stale}_t.jpg`), old, old);
    // 지금 쓰는 사진도 오래된 파일로 만든다: 그래도 남아야 한다
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    utimesSync(join(dir, `${current}.jpg`), longAgo, longAgo);
    utimesSync(join(dir, `${current}_t.jpg`), longAgo, longAgo);

    const r = await app.get(MaintenanceService).cleanup(new Date());
    expect(r.avatars).toBe(2);
    expect(r.photos).toMatchObject({ orphanFiles: 0 });
    expect(avatarFiles(aId)).toEqual([`${current}.jpg`, `${current}_t.jpg`, `${fresh}.jpg`].sort());
    await a.get(`/profiles/${aId}/avatar`).expect(200);
    // 두 번 돌아도 같다
    expect((await app.get(MaintenanceService).cleanup(new Date())).avatars).toBe(0);
    rmSync(join(dir, `${fresh}.jpg`));
  });

  it('removeAvatar 로 사진을 지운다', async () => {
    const res = await save(a, { statusMessage: '꾸준히', removeAvatar: true }).expect(200);
    expect(res.body.avatarId).toBeNull();
    expect(avatarFiles(aId)).toEqual([]);
    await a.get(`/profiles/${aId}/avatar`).expect(404);
    await b.get(`/profiles/${aId}/avatar`).expect(404);
    // 없는데 또 지워도 성공
    await save(a, { removeAvatar: true }).expect(200);
  });

  it('파일이 사라졌으면(디스크 유실) 사진은 404, 프로필은 그대로 보인다', async () => {
    const id = (await save(a, {}, jpeg).expect(200)).body.avatarId as string;
    rmSync(join(DIR, aId, 'avatar'), { recursive: true, force: true });
    await a.get(`/profiles/${aId}/avatar`).expect(404);
    expect((await a.get(`/profiles/${aId}`).expect(200)).body.avatarId).toBe(id);
  });

  it(`사진 바꾸기는 하루 ${AVATAR_MAX_CHANGES_PER_DAY}번까지, 글자만 바꾸는 것은 세지 않는다`, async () => {
    // 거부된 사진은 세지 않는다
    for (let i = 0; i < AVATAR_MAX_CHANGES_PER_DAY; i += 1) {
      await save(a, {}, Buffer.from('not an image')).expect(422);
    }
    for (let i = 0; i < AVATAR_MAX_CHANGES_PER_DAY; i += 1) {
      await save(a, {}, jpeg).expect(200);
    }
    const res = await save(a, { nickname: '초과' }, jpeg);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PHOTO_DAILY_LIMIT');
    expect((await me(a)).nickname).toBe('A');
    await save(a, { nickname: '글자만' }).expect(200);
  });
});
