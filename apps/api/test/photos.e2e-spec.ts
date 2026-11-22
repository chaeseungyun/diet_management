/**
 * 식사 사진 업로드·보관 (EXT-02a, DEC-069·086).
 * 사용자 격리(404), 원본·EXIF 가 남지 않음, 기록 저장과 함께 붙이기, 상한, 기록 취소 시 삭제, 만료.
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { PHOTO_MAX_UPLOAD_BYTES, todayIn } from '@diet/shared';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { PhotosService } from '../src/photos/photos.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login, testEnv } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const DIR = testEnv.photosDir;

/** 폴더 아래 모든 파일(상대 경로) */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

describe('phase 3: meal photos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let jpeg: Buffer;

  const upload = (who: ReturnType<typeof api>, file: Buffer, recordId?: string) => {
    const req = who.post('/meal-photos').attach('file', file, 'meal.jpg');
    return recordId ? req.field('mealRecordId', recordId) : req;
  };
  const outside = (extra: Record<string, unknown> = {}) => ({
    status: 'eaten',
    kind: 'outside',
    outsideItems: [{ name: '김치찌개' }],
    ...extra,
  });

  beforeAll(async () => {
    rmSync(DIR, { recursive: true, force: true });
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'photo-a', 'A'));
    b = api(server, await login(server, 'photo-b', 'B'));
    // 휴대폰 사진 흉내: 3000×2000, 옆으로 누운 방향(EXIF 6), 위치 정보 포함
    jpeg = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#cc8844' },
    })
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
  });

  afterAll(async () => {
    await app.close();
    rmSync(DIR, { recursive: true, force: true });
  });

  // 테스트를 돌리는 PC 의 디스크가 80 % 넘게 차 있어도 결과가 같게 한다
  beforeEach(() => {
    jest.spyOn(app.get(PhotosService), 'diskUsedRatio').mockResolvedValue(0.5);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    app.get(PhotosService).resetUploadCounts();
    await prisma.mealPhoto.deleteMany({});
    await prisma.mealRecord.deleteMany({});
    rmSync(DIR, { recursive: true, force: true });
  });

  it('stores only a resized copy and a thumbnail, without EXIF or the original', async () => {
    const res = await upload(a, jpeg).expect(201);
    // 방향을 돌려 구웠으므로 세로 사진이 된다. 긴 변 1600
    expect(res.body).toMatchObject({
      mealRecordId: null,
      width: 1067,
      height: 1600,
      expired: false,
    });

    const files = filesUnder(DIR);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith('.jpg'))).toBe(true);
    for (const f of files) {
      const meta = await sharp(readFileSync(f)).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
    const row = await prisma.mealPhoto.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.bytes).toBe(files.reduce((n, f) => n + readFileSync(f).length, 0));
    expect(row.bytes).toBeLessThan(jpeg.length);

    const view = await a.get(`/meal-photos/${res.body.id}`).expect(200);
    expect(view.headers['content-type']).toBe('image/jpeg');
    expect(view.headers['cache-control']).toBe('private, no-cache');
    // 그대로면 본문 없이 304
    await a
      .get(`/meal-photos/${res.body.id}`)
      .set('If-None-Match', String(view.headers['etag']))
      .expect(304);
    const thumb = await a.get(`/meal-photos/${res.body.id}?size=thumb`).expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).height).toBe(320);
  });

  it("returns 404 for another user's photo (D-06)", async () => {
    const id = (await upload(a, jpeg).expect(201)).body.id;
    await b.get(`/meal-photos/${id}`).expect(404);
    await b.delete(`/meal-photos/${id}`).expect(404);
    // 남의 임시 사진을 내 기록에 붙일 수 없다
    await b
      .put(`/meal-records/${TODAY}/lunch`)
      .send(outside({ version: null, photoIds: [id] }))
      .expect(404);
    // 남의 기록에 바로 붙일 수 없다
    const rec = await a.put(`/meal-records/${TODAY}/lunch`).send(outside({ version: null }));
    await upload(b, jpeg, rec.body.id).expect(404);
    await a.get(`/meal-photos/${id}`).expect(200);
  });

  it('rejects files that are not JPEG/PNG/WebP and files over 10 MB', async () => {
    const bad = await upload(a, Buffer.from('not an image')).expect(422);
    expect(bad.body.code).toBe('PHOTO_UNSUPPORTED');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    expect((await upload(a, gif).expect(422)).body.code).toBe('PHOTO_UNSUPPORTED');
    expect((await a.post('/meal-photos').expect(422)).body.code).toBe('PHOTO_UNSUPPORTED');
    const big = await upload(a, Buffer.alloc(PHOTO_MAX_UPLOAD_BYTES + 1)).expect(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(filesUnder(DIR)).toHaveLength(0);
    expect(await prisma.mealPhoto.count()).toBe(0);
  });

  it('attaches uploaded photos when the record is saved (DEC-086)', async () => {
    const p1 = (await upload(a, jpeg).expect(201)).body.id;
    const p2 = (await upload(a, jpeg).expect(201)).body.id;
    const saved = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .set('Idempotency-Key', 'photo-save-1')
      .send(outside({ version: null, photoIds: [p1, p2] }))
      .expect(200);
    expect(saved.body.photos.map((p: { id: string }) => p.id)).toEqual([p1, p2]);
    expect(saved.body.photos[0].mealRecordId).toBe(saved.body.id);

    // 수정 저장: photoIds 를 보내지 않아도 사진은 남고, 이미 붙은 id 를 다시 보내도 된다
    const edited = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send(
        outside({
          version: saved.body.version,
          outsideItems: [{ name: '된장찌개' }],
          photoIds: [p1],
        }),
      )
      .expect(200);
    expect(edited.body.photos).toHaveLength(2);

    // 다른 기록에 붙은 사진은 붙일 수 없다
    await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send(outside({ version: null, photoIds: [p1] }))
      .expect(404);

    const day = await a.get(`/days/${TODAY}`).expect(200);
    const lunch = day.body.slots.find((s: { slot: string }) => s.slot === 'lunch');
    expect(lunch.photos).toHaveLength(2);

    // 추가 간식도 같은 방식
    const p3 = (await upload(a, jpeg).expect(201)).body.id;
    const extra = await a
      .post(`/meal-records/${TODAY}/extra`)
      .send(outside({ outsideItems: [{ name: '붕어빵' }], photoIds: [p3] }))
      .expect(201);
    expect(extra.body.photos).toHaveLength(1);
    await a.delete(`/meal-records/${TODAY}/extra/${extra.body.id}`).expect(204);
    await a.get(`/meal-photos/${p3}`).expect(404);
    expect(await prisma.mealPhoto.count({ where: { id: p3 } })).toBe(0);
  });

  it('adds and removes a photo on a saved record without touching version or completion', async () => {
    const rec = (await a.put(`/meal-records/${TODAY}/lunch`).send(outside({ version: null }))).body;
    await a.put(`/days/${TODAY}/completion`).send({}).expect(200);

    const photo = (await upload(a, jpeg, rec.id).expect(201)).body;
    expect(photo.mealRecordId).toBe(rec.id);
    let now = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    expect(now.version).toBe(rec.version);
    expect(now.photos).toHaveLength(1);

    await a.delete(`/meal-photos/${photo.id}`).expect(204);
    now = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    expect(now.version).toBe(rec.version);
    expect(now.photos).toHaveLength(0);
    expect(filesUnder(DIR)).toHaveLength(0);
    expect((await a.get(`/days/${TODAY}`).expect(200)).body.completion).not.toBeNull();
    await a.delete(`/meal-photos/${photo.id}`).expect(404);
  });

  it('deletes photos when the record stops being eaten', async () => {
    const p1 = (await upload(a, jpeg).expect(201)).body.id;
    const rec = (
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send(outside({ version: null, photoIds: [p1] }))
        .expect(200)
    ).body;
    // 먹지 않은 기록에는 붙일 수 없다
    const p2 = (await upload(a, jpeg).expect(201)).body.id;
    const no = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'skipped', version: rec.version, photoIds: [p2] })
      .expect(422);
    expect(no.body.code).toBe('PHOTO_RECORD_NOT_EATEN');
    await a.get(`/meal-photos/${p1}`).expect(200);

    const undone = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'unrecorded', version: rec.version })
      .expect(200);
    expect(undone.body.photos).toEqual([]);
    await a.get(`/meal-photos/${p1}`).expect(404);
    expect(await prisma.mealPhoto.count({ where: { id: p1 } })).toBe(0);
    // 남은 것은 붙지 않은 임시 사진 p2 의 파일 2개뿐
    expect(filesUnder(DIR)).toHaveLength(2);
    const direct = await upload(a, jpeg, rec.id).expect(422);
    expect(direct.body.code).toBe('PHOTO_RECORD_NOT_EATEN');
  });

  it('counts deleted photos toward 30 uploads per day', async () => {
    const small = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    // 올리고 지우기를 되풀이하면 남은 사진은 0 장이어도 30번에서 막힌다
    for (let i = 0; i < 30; i++) {
      const id = (await upload(a, small).expect(201)).body.id;
      await a.delete(`/meal-photos/${id}`).expect(204);
    }
    const next = await upload(a, small).expect(422);
    expect(next.body.code).toBe('PHOTO_DAILY_LIMIT');
    expect(await prisma.mealPhoto.count()).toBe(0);
    await upload(b, small).expect(201);
  });

  it('limits photos to 5 per record and 10 per day', async () => {
    const small = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await upload(a, small).expect(201)).body.id);
    const eleventh = await upload(a, small).expect(422);
    expect(eleventh.body.code).toBe('PHOTO_DAILY_LIMIT');
    // 다른 사용자는 영향받지 않는다
    await upload(b, small).expect(201);

    const rec = (
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send(outside({ version: null, photoIds: ids.slice(0, 5) }))
        .expect(200)
    ).body;
    const sixth = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send(outside({ version: rec.version, photoIds: [ids[5]] }))
      .expect(422);
    expect(sixth.body.code).toBe('PHOTO_RECORD_LIMIT');
    // 거부된 저장은 기록을 바꾸지 않는다(한 트랜잭션)
    const after = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    expect(after.version).toBe(rec.version);
    expect(after.photos).toHaveLength(5);

    // 지우면 오늘 장수에서 빠진다
    await a.delete(`/meal-photos/${ids[9]}`).expect(204);
    await upload(a, small).expect(201);
  });

  it('keeps a placeholder for expired photos but serves no file', async () => {
    const p1 = (await upload(a, jpeg).expect(201)).body.id;
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send(outside({ version: null, photoIds: [p1] }))
      .expect(200);
    await prisma.mealPhoto.update({
      where: { id: p1 },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await a.get(`/meal-photos/${p1}`).expect(404);
    await a.get(`/meal-photos/${p1}?size=thumb`).expect(404);
    const rec = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
    expect(rec.photos).toHaveLength(1);
    expect(rec.photos[0]).toMatchObject({ id: p1, expired: true });
  });

  it('holds the limits under concurrent requests', async () => {
    const small = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    // 동시에 14장: 하루 10장만 들어간다
    const all = await Promise.all(Array.from({ length: 14 }, () => upload(a, small)));
    const ok = all.filter((r) => r.status === 201);
    expect(ok).toHaveLength(10);
    expect(all.filter((r) => r.body.code === 'PHOTO_DAILY_LIMIT')).toHaveLength(4);
    expect(filesUnder(DIR)).toHaveLength(20);

    // 같은 임시 사진을 두 끼니가 동시에 붙이면 한쪽만 가진다
    const id = ok[0]!.body.id;
    const [lunch, dinner] = await Promise.all(
      ['lunch', 'dinner'].map((slot) =>
        a.put(`/meal-records/${TODAY}/${slot}`).send(outside({ version: null, photoIds: [id] })),
      ),
    );
    expect([lunch!.status, dinner!.status].sort()).toEqual([200, 404]);
    expect(await prisma.mealPhoto.count({ where: { id, mealRecordId: { not: null } } })).toBe(1);
  });

  describe('daily cleanup (DEC-069·087)', () => {
    const DAY = 86_400_000;
    const cleanup = async (now = new Date()) =>
      (await app.get(MaintenanceService).cleanup(now)).photos!;
    const userId = async () =>
      (await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id;
    /** 파일 없는 행: 용량·날짜만 흉내 낸다 */
    const fakeRows = async (count: number, bytes: number, ageDays: number) => {
      const uid = await userId();
      const createdAt = new Date(Date.now() - ageDays * DAY);
      await prisma.mealPhoto.createMany({
        data: Array.from({ length: count }, () => ({
          userId: uid,
          path: `fake/${randomUUID()}.jpg`,
          thumbPath: `fake/${randomUUID()}_t.jpg`,
          bytes,
          width: 1,
          height: 1,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 30 * DAY),
        })),
      });
    };
    const backdate = (id: string, days: number) =>
      prisma.mealPhoto.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - days * DAY) },
      });

    it('removes drafts after 24 hours and keeps attached photos', async () => {
      const oldDraft = (await upload(a, jpeg).expect(201)).body.id;
      const newDraft = (await upload(a, jpeg).expect(201)).body.id;
      const attached = (await upload(a, jpeg).expect(201)).body.id;
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send(outside({ version: null, photoIds: [attached] }))
        .expect(200);
      await backdate(oldDraft, 2);
      await backdate(attached, 2);

      expect(await cleanup()).toMatchObject({ drafts: 1, swept: 1, purged: 0, retentionDays: 30 });
      expect(await prisma.mealPhoto.findUnique({ where: { id: oldDraft } })).toBeNull();
      expect(filesUnder(DIR)).toHaveLength(4);
      await a.get(`/meal-photos/${newDraft}`).expect(200);
      await a.get(`/meal-photos/${attached}`).expect(200);
      // 두 번 돌아도 같다
      expect(await cleanup()).toMatchObject({ drafts: 0, swept: 0, purged: 0 });
    });

    it('purges files past retention and leaves a placeholder row', async () => {
      const p1 = (await upload(a, jpeg).expect(201)).body.id;
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send(outside({ version: null, photoIds: [p1] }))
        .expect(200);
      await backdate(p1, 31);

      expect(await cleanup()).toMatchObject({ purged: 1, retentionDays: 30 });
      expect(filesUnder(DIR)).toHaveLength(0);
      await a.get(`/meal-photos/${p1}`).expect(404);
      const rec = (await a.get(`/meal-records/${TODAY}/lunch`).expect(200)).body;
      expect(rec.photos[0]).toMatchObject({ id: p1, expired: true });
      expect(await cleanup()).toMatchObject({ purged: 0 });
      // 자리 표시는 사용자가 지울 수 있다
      await a.delete(`/meal-photos/${p1}`).expect(204);
    });

    it('shortens retention when inflow exceeds the budget, down to 7 days, then refuses uploads', async () => {
      const p9 = (await upload(a, jpeg).expect(201)).body.id;
      const p11 = (await upload(a, jpeg).expect(201)).body.id;
      const rec = (
        await a
          .put(`/meal-records/${TODAY}/lunch`)
          .send(outside({ version: null, photoIds: [p9, p11] }))
          .expect(200)
      ).body;
      expect(rec.photos).toHaveLength(2);
      await backdate(p9, 9);
      await backdate(p11, 11);
      // 최근 14일 유입 ≈ 30 GB → 하루 2.1 GB → 20 GB ÷ 2.1 GB = 10일 (기록에 붙은 행이어야 임시 정리에 안 걸린다)
      await fakeRows(14, 2_147_000_000, 1);
      await prisma.mealPhoto.updateMany({
        where: { mealRecordId: null },
        data: { mealRecordId: rec.id },
      });

      expect(await cleanup()).toMatchObject({ retentionDays: 10, purged: 1 });
      await a.get(`/meal-photos/${p11}`).expect(404);
      await a.get(`/meal-photos/${p9}`).expect(200);

      // 보관 중인 양이 예산(20 GB)을 넘었다 → 새 업로드 거부
      const full = await upload(a, jpeg).expect(422);
      expect(full.body.code).toBe('PHOTO_STORAGE_FULL');

      // 유입이 더 늘어도 7일 아래로는 줄이지 않는다
      await fakeRows(30, 2_147_000_000, 1);
      await prisma.mealPhoto.updateMany({
        where: { mealRecordId: null },
        data: { mealRecordId: rec.id },
      });
      await backdate(p9, 6);
      expect(await cleanup()).toMatchObject({ retentionDays: 7, purged: 0 });
      await a.get(`/meal-photos/${p9}`).expect(200);
    });

    it('treats disk usage over 80% as a trigger: 7-day retention and no uploads', async () => {
      const p8 = (await upload(a, jpeg).expect(201)).body.id;
      await a
        .put(`/meal-records/${TODAY}/lunch`)
        .send(outside({ version: null, photoIds: [p8] }))
        .expect(200);
      await backdate(p8, 8);
      expect(await cleanup()).toMatchObject({ retentionDays: 30, purged: 0 });

      jest.spyOn(app.get(PhotosService), 'diskUsedRatio').mockResolvedValue(0.81);
      const full = await upload(a, jpeg).expect(422);
      expect(full.body.code).toBe('PHOTO_STORAGE_FULL');
      expect(await cleanup()).toMatchObject({ retentionDays: 7, purged: 1 });
      await a.get(`/meal-photos/${p8}`).expect(404);
    });

    it('removes old files that have no row and nothing else', async () => {
      const kept = (await upload(a, jpeg).expect(201)).body.id;
      const dir = join(DIR, await userId(), '2026-01');
      mkdirSync(dir, { recursive: true });
      const old = join(dir, `${randomUUID()}.jpg`);
      const fresh = join(dir, `${randomUUID()}.jpg`);
      const other = join(dir, 'notes.txt');
      for (const f of [old, fresh, other]) writeFileSync(f, 'x');
      const past = new Date(Date.now() - 2 * 3600_000);
      utimesSync(old, past, past);
      utimesSync(other, past, past);

      expect(await cleanup()).toMatchObject({ orphanFiles: 1 });
      expect(existsSync(old)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(other)).toBe(true);
      await a.get(`/meal-photos/${kept}`).expect(200);
    });
  });
});
