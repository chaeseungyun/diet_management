import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import {
  PHOTO_MAX_PER_DAY,
  PHOTO_MAX_PER_RECORD,
  PHOTO_MAX_RETENTION_DAYS,
  todayIn,
} from '@diet/shared';
import { ENV, type Env } from '../config/env';
import {
  PHOTO_BUDGET_BYTES,
  PHOTO_DISK_USAGE_LIMIT,
  PHOTO_INFLOW_WINDOW_DAYS,
  photoRetentionDays,
} from '../domain/photo-retention';
import { unprocessable } from '../common/errors';
import { UUID_RE } from '../common/validators';
import type { Tx } from '../common/idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { MealPhotoDto } from './photos.dto';

/** 보기용: 긴 변 1600 px, JPEG 80. 썸네일: 320 px (DEC-069) */
const VIEW_PX = 1600;
const THUMB_PX = 320;
const JPEG_QUALITY = 80;
/** 받는 형식. HEIC 는 sharp 기본 바이너리가 풀지 못한다 (DEC-086) */
const INPUT_FORMATS = new Set(['jpeg', 'png', 'webp']);
/** 디코딩 폭탄 방지: 5천만 화소까지만 푼다 */
const MAX_INPUT_PIXELS = 50_000_000;
const SWEEP_BATCH = 500;

/** 기록에 붙이지 않은 임시 사진을 두는 시간 (DEC-087) */
const DRAFT_TTL_MS = 24 * 3600_000;
/** 행 없는 파일은 이만큼 지난 것만 지운다(지금 올리는 중인 파일을 건드리지 않게) */
const ORPHAN_MIN_AGE_MS = 3600_000;
const MONTH_RE = /^\d{4}-\d{2}$/;
const PHOTO_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(_t)?\.jpg$/;

export type PhotoSize = 'view' | 'thumb';

export type PhotoCleanupResult = {
  /** 24시간 지난 임시 사진 */
  drafts: number;
  /** 이번에 적용한 보관 일수 (7~30) */
  retentionDays: number;
  /** 보관 기간이 지나 파일을 지운 사진(행은 자리 표시로 남는다) */
  purged: number;
  /** 삭제 표시된 사진의 파일·행 */
  swept: number;
  /** 행 없는 파일 */
  orphanFiles: number;
};

/**
 * 식사 사진 저장·조회·삭제 (EXT-02a, DEC-069·086).
 * 원본은 메모리에서만 다루고 디스크에는 리사이즈본과 썸네일만 쓴다(EXIF 는 다시 인코딩하면서 빠진다).
 * DB 행이 기준이다: 파일을 먼저 쓰고 행을 만들며, 지울 때는 deletedAt 을 먼저 찍고 파일을 지운 뒤 행을 없앤다.
 * 중간에 죽어도 남는 것은 "행 없는 파일"(업로드 실패) 또는 "deletedAt 이 찍힌 행"뿐이고 정리 작업이 치운다.
 */
@Injectable()
export class PhotosService {
  private readonly log = new Logger(PhotosService.name);
  /** 이미지 처리는 한 번에 한 장만 (2GB VM: 큰 사진 한 장을 푸는 데 수백 MB 가 든다) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // 2GB VM 에서 큰 사진 여러 장을 동시에 풀지 않게 한다
    sharp.concurrency(1);
    sharp.cache(false);
  }

  /**
   * 업로드. mealRecordId 가 없으면 임시 사진으로 두고 기록 저장(`photoIds`) 때 붙인다.
   * 있으면 그 기록(본인 것·먹었음)에 바로 붙이며 기록의 version·하루 완료는 건드리지 않는다.
   */
  async upload(
    user: User,
    input: Buffer | undefined,
    mealRecordId: string | undefined,
    now: Date = new Date(),
  ): Promise<MealPhotoDto> {
    if (!input || input.length === 0) throw unprocessable('PHOTO_UNSUPPORTED', 'file is required');
    await this.assertStorage();
    // 먼저 싸게 거른다. 확정 판정은 아래 트랜잭션에서 행을 잠그고 다시 한다
    if (mealRecordId) await this.assertAttachable(this.prisma, user.id, mealRecordId, now);
    await this.assertDailyLimit(this.prisma, user, now);

    const { view, thumb } = await this.serial(() => this.process(input));
    const id = randomUUID();
    const month = todayIn(user.timezone, now).slice(0, 7);
    const path = `${user.id}/${month}/${id}.jpg`;
    const thumbPath = `${user.id}/${month}/${id}_t.jpg`;
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), view.data);
    await writeFile(this.abs(thumbPath), thumb.data);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // 같은 사용자의 업로드를 줄 세워 하루 상한을 동시 요청이 넘지 못하게 한다.
        // NO KEY: 이 사용자를 참조하는 다른 쓰기(FK 의 KEY SHARE)를 막지 않아 식사 기록 쓰기와 교착하지 않는다
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR NO KEY UPDATE`;
        await this.assertDailyLimit(tx, user, now);
        if (mealRecordId) {
          // 기록 쓰기·삭제와 같은 행 잠금: 그 사이 '먹었음' 이 아니게 됐거나 지워졌으면 여기서 거부된다
          await tx.$queryRaw`SELECT id FROM meal_records WHERE id = ${mealRecordId}::uuid FOR NO KEY UPDATE`;
          await this.assertAttachable(tx, user.id, mealRecordId, now);
        }
        return tx.mealPhoto.create({
          data: {
            id,
            userId: user.id,
            mealRecordId: mealRecordId ?? null,
            path,
            thumbPath,
            bytes: view.data.length + thumb.data.length,
            width: view.info.width,
            height: view.info.height,
            createdAt: now,
            expiresAt: new Date(now.getTime() + PHOTO_MAX_RETENTION_DAYS * 86_400_000),
          },
        });
      });
      return MealPhotoDto.from(row, now);
    } catch (e) {
      // 커밋은 됐는데 응답만 잃었을 수 있다. 행이 있으면 파일을 남기고 성공으로 답한다.
      // 확인조차 못 하면 파일을 그대로 둔다(행이 없으면 정리 작업이 지운다)
      const row = await this.prisma.mealPhoto.findUnique({ where: { id } }).catch(() => undefined);
      if (row) return MealPhotoDto.from(row, now);
      if (row === null) await this.unlink({ path, thumbPath });
      throw e;
    }
  }

  /** 파일 열기. 타인·삭제·만료·파일 없음은 모두 404 (D-06) */
  async open(
    user: User,
    id: string,
    size: PhotoSize,
    now: Date = new Date(),
  ): Promise<{ stream: ReadStream; length: number }> {
    const row = await this.prisma.mealPhoto.findFirst({
      where: { id, userId: user.id, deletedAt: null, purgedAt: null, expiresAt: { gt: now } },
    });
    if (!row) throw new NotFoundException();
    const file = this.abs(size === 'thumb' ? row.thumbPath : row.path);
    const st = await stat(file).catch(() => null);
    if (!st) throw new NotFoundException();
    return { stream: createReadStream(file), length: st.size };
  }

  /** 사용자 삭제. 만료돼 자리만 남은 사진도 지울 수 있다. 기록의 version·하루 완료는 건드리지 않는다 */
  async remove(user: User, id: string): Promise<void> {
    const updated = await this.prisma.mealPhoto.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException();
    await this.sweepDeleted(user.id);
  }

  /**
   * 기록 저장 트랜잭션 안에서 임시 사진을 기록에 붙인다. 이미 이 기록에 붙은 id 는 그대로 둔다(재전송 안전).
   * 본인 것이 아니거나 다른 기록에 붙은 id 는 404.
   */
  async attach(tx: Tx, userId: string, mealRecordId: string, photoIds: string[]): Promise<void> {
    const ids = [...new Set(photoIds.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return;
    const rows = await tx.mealPhoto.findMany({
      where: { id: { in: ids }, userId, deletedAt: null },
    });
    if (rows.length !== ids.length) throw new NotFoundException();
    if (rows.some((r) => r.mealRecordId !== null && r.mealRecordId !== mealRecordId)) {
      throw new NotFoundException();
    }
    const fresh = rows.filter((r) => r.mealRecordId === null).map((r) => r.id);
    if (fresh.length === 0) return;
    await this.assertRecordLimit(tx, mealRecordId, fresh.length, new Date());
    // 읽은 뒤 다른 요청이 먼저 붙였거나 지웠으면 장수가 모자란다 → 404
    const moved = await tx.mealPhoto.updateMany({
      where: { id: { in: fresh }, userId, mealRecordId: null, deletedAt: null },
      data: { mealRecordId },
    });
    if (moved.count !== fresh.length) throw new NotFoundException();
  }

  /**
   * 기록이 '먹었음' 이 아니게 되거나 지워질 때 그 기록의 사진을 삭제 표시한다(트랜잭션 안).
   * 파일은 커밋 뒤 sweepDeleted 가 지운다. 표시한 장수를 돌려준다.
   */
  async markRecordDeleted(tx: Tx, mealRecordId: string): Promise<number> {
    const r = await tx.mealPhoto.updateMany({
      where: { mealRecordId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return r.count;
  }

  /**
   * 삭제 표시된 사진의 파일을 지우고 행을 없앤다. 여러 번 돌아도 같은 결과다.
   * 요청 처리 뒤에는 그 사용자 것만, 정리 작업은 userId 없이 전부 돈다.
   * 실패는 기록만 하고 던지지 않는다(다음 실행이 메운다).
   */
  async sweepDeleted(userId?: string): Promise<number> {
    let done = 0;
    try {
      const rows = await this.prisma.mealPhoto.findMany({
        where: { deletedAt: { not: null }, ...(userId ? { userId } : {}) },
        select: { id: true, path: true, thumbPath: true },
        take: SWEEP_BATCH,
      });
      for (const row of rows) {
        await this.unlink(row);
        await this.prisma.mealPhoto.deleteMany({ where: { id: row.id } });
        done += 1;
      }
    } catch (e) {
      this.log.error(`photo sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return done;
  }

  /**
   * 매일 정리 (DEC-069·087). 놓친 날은 다음 실행이 메우고 두 번 돌아도 결과가 같다.
   * 1) 24시간 지난 임시 사진 삭제 표시 2) 보관 일수 재계산 → expires_at 다시 맞춤
   * 3) 만료 사진의 파일 삭제(행은 자리 표시로 남김) 4) 삭제 표시된 것 정리 5) 행 없는 파일 삭제
   */
  async cleanup(now: Date = new Date()): Promise<PhotoCleanupResult> {
    const drafts = await this.prisma.mealPhoto.updateMany({
      where: {
        mealRecordId: null,
        deletedAt: null,
        createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) },
      },
      data: { deletedAt: now },
    });

    const since = new Date(now.getTime() - PHOTO_INFLOW_WINDOW_DAYS * 86_400_000);
    const inflow = await this.sumBytes(
      Prisma.sql`created_at >= ${since} AND created_at <= ${now} AND deleted_at IS NULL`,
    );
    const disk = await this.diskUsedRatio();
    const diskFull = disk !== null && disk > PHOTO_DISK_USAGE_LIMIT;
    const { days, raw } = photoRetentionDays(inflow, diskFull);
    // 보관 일수가 바뀌면 아직 파일이 있는 사진 전부의 만료 시각이 따라 바뀐다
    await this.prisma.$executeRaw`
      UPDATE meal_photos
      SET expires_at = created_at + make_interval(days => ${days}::int)
      WHERE purged_at IS NULL
        AND expires_at <> created_at + make_interval(days => ${days}::int)`;

    let purged = 0;
    for (;;) {
      const rows = await this.prisma.mealPhoto.findMany({
        where: { expiresAt: { lte: now }, purgedAt: null, deletedAt: null },
        select: { id: true, path: true, thumbPath: true },
        take: 200,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await this.unlink(row);
        await this.prisma.mealPhoto.update({ where: { id: row.id }, data: { purgedAt: now } });
      }
      purged += rows.length;
    }

    let swept = 0;
    for (;;) {
      const n = await this.sweepDeleted();
      swept += n;
      if (n < SWEEP_BATCH) break;
    }

    const orphanFiles = await this.removeOrphanFiles(now);

    // 운영자 알림은 로그로 낸다 (ops.md §10-2)
    const stored = await this.sumBytes(Prisma.sql`purged_at IS NULL`);
    const diskText = disk === null ? 'n/a' : `${Math.round(disk * 100)}%`;
    const state = `retentionDays=${days} raw=${raw ?? 'unlimited'} storedMB=${Math.round(stored / 1048576)} disk=${diskText}`;
    if (diskFull || stored >= PHOTO_BUDGET_BYTES) {
      this.log.error(`photo storage full, uploads are refused: ${state}`);
    } else if (days < PHOTO_MAX_RETENTION_DAYS) {
      this.log.warn(`photo retention below ${PHOTO_MAX_RETENTION_DAYS} days: ${state}`);
    }
    return { drafts: drafts.count, retentionDays: days, purged, swept, orphanFiles };
  }

  /** 사진 폴더가 있는 디스크의 사용률(0~1). 폴더가 아직 없거나 읽을 수 없으면 null */
  async diskUsedRatio(): Promise<number | null> {
    try {
      const s = await statfs(this.env.photosDir);
      return s.blocks > 0 ? 1 - s.bavail / s.blocks : null;
    } catch {
      return null;
    }
  }

  /**
   * 저장 공간이 찼으면 새 업로드를 거부한다 (DEC-069: 7일 아래로 조용히 줄여 지우지 않는다).
   * 찼다 = 보관 중인 사진이 예산(20 GB) 이상이거나 디스크 사용률 80 % 초과.
   */
  private async assertStorage(): Promise<void> {
    const [stored, disk] = await Promise.all([
      this.sumBytes(Prisma.sql`purged_at IS NULL`),
      this.diskUsedRatio(),
    ]);
    if (stored >= PHOTO_BUDGET_BYTES || (disk !== null && disk > PHOTO_DISK_USAGE_LIMIT)) {
      this.log.error(
        `photo upload refused: storedMB=${Math.round(stored / 1048576)} disk=${disk === null ? 'n/a' : `${Math.round(disk * 100)}%`}`,
      );
      throw unprocessable('PHOTO_STORAGE_FULL', 'photo storage is full');
    }
  }

  /** bytes 합계. int 컬럼의 합이 int 범위를 넘으므로 float8 로 받는다 */
  private async sumBytes(where: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COALESCE(SUM(bytes), 0)::float8 AS n FROM meal_photos WHERE ${where}`;
    return rows[0]?.n ?? 0;
  }

  /**
   * 행 없는 파일(업로드 도중 죽음, 파일 삭제 실패)을 지운다.
   * `<user uuid>/<yyyy-mm>/<photo uuid>[_t].jpg` 꼴만 본다: 폴더 설정이 잘못돼도 다른 파일은 건드리지 않는다.
   */
  private async removeOrphanFiles(now: Date): Promise<number> {
    let removed = 0;
    try {
      const root = this.env.photosDir;
      for (const userDir of await this.list(root, UUID_RE)) {
        for (const monthDir of await this.list(join(root, userDir), MONTH_RE)) {
          const dir = join(root, userDir, monthDir);
          const names = await this.list(dir, PHOTO_FILE_RE);
          const ids = [...new Set(names.map((n) => n.slice(0, 36)))];
          const alive = new Set<string>();
          for (let i = 0; i < ids.length; i += 500) {
            const rows = await this.prisma.mealPhoto.findMany({
              where: { id: { in: ids.slice(i, i + 500) }, purgedAt: null },
              select: { id: true },
            });
            for (const r of rows) alive.add(r.id);
          }
          for (const name of names) {
            if (alive.has(name.slice(0, 36))) continue;
            const file = join(dir, name);
            const st = await stat(file).catch(() => null);
            if (!st || now.getTime() - st.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
            const ok = await rm(file, { force: true }).then(
              () => true,
              () => false,
            );
            if (ok) removed += 1;
          }
        }
      }
    } catch (e) {
      this.log.error(`orphan photo scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return removed;
  }

  private async list(dir: string, pattern: RegExp): Promise<string[]> {
    const names = await readdir(dir).catch(() => [] as string[]);
    return names.filter((n) => pattern.test(n));
  }

  /** 바로 붙일 수 있는 기록인가: 본인 것(404), 먹었음(422), 기록당 장수(422) */
  private async assertAttachable(
    db: Tx | PrismaService,
    userId: string,
    mealRecordId: string,
    now: Date,
  ): Promise<void> {
    const record = await db.mealRecord.findFirst({ where: { id: mealRecordId, userId } });
    if (!record) throw new NotFoundException();
    if (record.status !== 'eaten') {
      throw unprocessable('PHOTO_RECORD_NOT_EATEN', 'photos can be attached to eaten records only');
    }
    await this.assertRecordLimit(db, mealRecordId, 1, now);
  }

  private async assertRecordLimit(
    db: Tx | PrismaService,
    mealRecordId: string,
    adding: number,
    now: Date,
  ): Promise<void> {
    // 보관 기간이 지나 자리만 남은 사진은 세지 않는다
    const have = await db.mealPhoto.count({
      where: { mealRecordId, deletedAt: null, purgedAt: null, expiresAt: { gt: now } },
    });
    if (have + adding > PHOTO_MAX_PER_RECORD) {
      throw unprocessable(
        'PHOTO_RECORD_LIMIT',
        `a record can have at most ${PHOTO_MAX_PER_RECORD} photos`,
      );
    }
  }

  /** 사용자 시간대의 오늘 올린 장수(지운 것 제외). 상한은 디스크 보호용이다 (DEC-069) */
  private async assertDailyLimit(db: Tx | PrismaService, user: User, now: Date): Promise<void> {
    const today = todayIn(user.timezone, now);
    const recent = await db.mealPhoto.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        createdAt: { gte: new Date(now.getTime() - 26 * 3600_000) },
      },
      select: { createdAt: true },
    });
    const count = recent.filter((r) => todayIn(user.timezone, r.createdAt) === today).length;
    if (count >= PHOTO_MAX_PER_DAY) {
      throw unprocessable('PHOTO_DAILY_LIMIT', `at most ${PHOTO_MAX_PER_DAY} photos per day`);
    }
  }

  /** 보기용·썸네일 JPEG 을 만든다. 방향은 EXIF 대로 돌려 굽고 메타데이터는 싣지 않는다 */
  private async process(input: Buffer) {
    try {
      const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.format || !INPUT_FORMATS.has(meta.format)) {
        throw new Error(`format ${meta.format ?? 'unknown'}`);
      }
      const view = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(VIEW_PX, VIEW_PX, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });
      // 썸네일은 원본을 다시 풀지 않고 보기용에서 줄인다
      const thumb = await sharp(view.data)
        .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });
      return { view, thumb };
    } catch (e) {
      // 대부분 읽을 수 없는 파일이다. 서버 쪽 문제일 때 찾을 수 있게 이유를 남긴다
      const reason = e instanceof Error ? e.message : 'unknown';
      this.log.warn(`photo rejected: ${reason}`);
      throw unprocessable('PHOTO_UNSUPPORTED', `cannot read image: ${reason}`);
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private abs(relative: string): string {
    return join(this.env.photosDir, relative);
  }

  /**
   * 파일 지우기. 실패해도 던지지 않는다: 행 정리는 계속하고, 남은 파일은 행 없는 파일로 정리 작업이 다시 지운다.
   * (던지면 지울 수 없는 파일 하나가 뒤의 삭제를 전부 막는다)
   */
  private async unlink(p: { path: string; thumbPath: string }): Promise<void> {
    for (const file of [p.path, p.thumbPath]) {
      try {
        await rm(this.abs(file), { force: true });
      } catch (e) {
        this.log.error(`photo file remove failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
