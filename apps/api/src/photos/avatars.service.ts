import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AVATAR_THUMB_PX, AVATAR_VIEW_PX } from '@diet/shared';
import { ENV, type Env } from '../config/env';
import { UUID_RE } from '../common/validators';
import { PrismaService } from '../prisma/prisma.service';
import { PHOTO_FILE_RE, PhotosService, type PhotoSize } from './photos.service';

/** 프로필 사진 폴더 이름. 식사 사진의 `<yyyy-mm>` 폴더와 겹치지 않아 식사 사진 정리가 건드리지 않는다 */
const AVATAR_DIR = 'avatar';
/** 안 쓰는 파일은 이만큼 지난 것만 지운다(지금 저장 중인 파일을 건드리지 않게) */
const STALE_MIN_AGE_MS = 3600_000;

/**
 * 프로필 사진 파일 (DEC-104). `PHOTOS_DIR/<userId>/avatar/<avatarId>.jpg` 와 `_t.jpg`.
 * 기준은 `users.avatar_id` 다: 파일을 먼저 쓰고 그 id 를 사용자 행에 적는다. 만료가 없고 사진 예산에 세지 않는다.
 * 중간에 죽으면 남는 것은 "어느 사용자도 가리키지 않는 파일"뿐이고 매일 정리가 지운다.
 * 누가 볼 수 있는지는 여기서 판정하지 않는다(부르는 쪽이 접근 판정을 거친 사용자로만 부른다).
 */
@Injectable()
export class AvatarsService {
  private readonly log = new Logger(AvatarsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** 변환해서 파일로 쓰고 새 id 를 돌려준다. 사용자 행은 부르는 쪽이 갱신한다 */
  async write(userId: string, input: Buffer): Promise<string> {
    await this.photos.assertStorage();
    const { view, thumb } = await this.photos.convert(input, {
      viewPx: AVATAR_VIEW_PX,
      thumbPx: AVATAR_THUMB_PX,
      squareThumb: true,
    });
    const id = randomUUID();
    const dir = this.dir(userId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.jpg`), view.data);
    await writeFile(join(dir, `${id}_t.jpg`), thumb.data);
    return id;
  }

  /** 파일 지우기. 실패해도 던지지 않는다(남은 파일은 매일 정리가 지운다) */
  async remove(userId: string, avatarId: string): Promise<void> {
    for (const name of [`${avatarId}.jpg`, `${avatarId}_t.jpg`]) {
      try {
        await rm(join(this.dir(userId), name), { force: true });
      } catch (e) {
        this.log.error(`avatar file remove failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** 파일 열기. 파일이 없으면 404 (디스크를 잃고 DB 만 복원한 경우 포함) */
  async open(
    userId: string,
    avatarId: string,
    size: PhotoSize,
  ): Promise<{ stream: ReadStream; length: number }> {
    const file = join(this.dir(userId), size === 'thumb' ? `${avatarId}_t.jpg` : `${avatarId}.jpg`);
    const st = await stat(file).catch(() => null);
    if (!st) throw new NotFoundException();
    return { stream: createReadStream(file), length: st.size };
  }

  /**
   * 매일 정리: 사용자 행이 가리키지 않는 프로필 사진 파일(바꾸기·지우기 도중 죽음, 동시 저장)을 지운다.
   * 놓친 날은 다음 실행이 메우고 두 번 돌아도 결과가 같다. 지운 파일 수를 돌려준다.
   */
  async cleanup(now: Date = new Date()): Promise<number> {
    let removed = 0;
    const root = this.env.photosDir;
    const userDirs = (await readdir(root).catch(() => [] as string[])).filter((n) =>
      UUID_RE.test(n),
    );
    for (let i = 0; i < userDirs.length; i += 500) {
      const batch = userDirs.slice(i, i + 500);
      const rows = await this.prisma.user.findMany({
        where: { id: { in: batch } },
        select: { id: true, avatarId: true },
      });
      const current = new Map(rows.map((r) => [r.id, r.avatarId]));
      for (const userId of batch) {
        const dir = this.dir(userId);
        const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
          PHOTO_FILE_RE.test(n),
        );
        for (const name of names) {
          if (name.slice(0, 36) === current.get(userId)) continue;
          const file = join(dir, name);
          const st = await stat(file).catch(() => null);
          if (!st || now.getTime() - st.mtimeMs < STALE_MIN_AGE_MS) continue;
          const ok = await rm(file, { force: true }).then(
            () => true,
            () => false,
          );
          if (ok) removed += 1;
        }
      }
    }
    return removed;
  }

  private dir(userId: string): string {
    return join(this.env.photosDir, userId, AVATAR_DIR);
  }
}
