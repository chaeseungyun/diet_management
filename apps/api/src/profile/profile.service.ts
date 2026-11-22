import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import type { User } from '@prisma/client';
import { AVATAR_MAX_CHANGES_PER_DAY, todayIn } from '@diet/shared';
import { unprocessable } from '../common/errors';
import { MeDto } from '../me/me.dto';
import { AvatarsService } from '../photos/avatars.service';
import type { PhotoSize } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { SharingAccessService } from '../sharing/sharing-access.service';
import { ProfileDto, UpdateProfileDto } from './profile.dto';

/**
 * 프로필 (DEC-104). 내 프로필 저장은 요청 하나로 닉네임·상태 메시지·사진을 함께 바꾼다.
 * 남의 프로필은 `SharingAccessService.resolveProfileViewable` 이 돌려준 사용자로만 읽는다.
 */
@Injectable()
export class ProfileService {
  private readonly log = new Logger(ProfileService.name);
  /**
   * 사용자별 오늘 사진 바꾸기 횟수. 식사 사진의 올리기 횟수(DEC-089)처럼 프로세스 메모리에만 둔다:
   * 남용을 막는 용도라 재시작으로 0 이 돼도 된다.
   */
  private changes = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly avatars: AvatarsService,
    private readonly access: SharingAccessService,
  ) {}

  /**
   * 순서: 새 파일 쓰기 → 사용자 행 한 번 갱신 → 옛 파일 삭제.
   * 사진 변환이 실패하면 아무것도 바뀌지 않는다. 행 갱신이 실패하면 새 파일을 지운다.
   */
  async update(
    user: User,
    dto: UpdateProfileDto,
    file: Buffer | undefined,
    now: Date = new Date(),
  ): Promise<MeDto> {
    let newId: string | undefined;
    if (file && file.length > 0) {
      // 먼저 상한만 보고, 파일을 쓴 뒤에 센다: 거부된 사진(형식·저장 공간)은 횟수를 쓰지 않는다
      const day = this.assertChangeAllowed(user, now);
      newId = await this.avatars.write(user.id, file);
      this.changes.set(user.id, { day, count: this.changeCount(user.id, day) + 1 });
    }
    const avatar = newId !== undefined ? newId : dto.removeAvatar === true ? null : undefined;
    let updated: User;
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          nickname: dto.nickname,
          statusMessage: dto.statusMessage ? dto.statusMessage : null,
          ...(avatar !== undefined ? { avatarId: avatar } : {}),
        },
      });
    } catch (e) {
      if (newId) await this.avatars.remove(user.id, newId);
      throw e;
    }
    // 이 요청이 읽은 옛 사진만 지운다. 동시 저장으로 남은 파일은 매일 정리가 지운다
    if (avatar !== undefined && user.avatarId && user.avatarId !== avatar) {
      await this.avatars.remove(user.id, user.avatarId);
    }
    return MeDto.from(updated);
  }

  async profile(viewer: User, targetId: string): Promise<ProfileDto> {
    const { target, isMe, isFriend } = await this.access.resolveProfileViewable(viewer, targetId);
    return {
      userId: target.id,
      nickname: target.nickname,
      statusMessage: target.statusMessage,
      avatarId: target.avatarId,
      isMe,
      isFriend,
    };
  }

  /** 프로필 사진 파일. 볼 수 없는 사람·사진 없음·파일 없음은 모두 404 */
  async openAvatar(
    viewer: User,
    targetId: string,
    size: PhotoSize,
  ): Promise<{ avatarId: string; stream: ReadStream; length: number }> {
    const { target } = await this.access.resolveProfileViewable(viewer, targetId);
    if (!target.avatarId) throw new NotFoundException();
    const opened = await this.avatars.open(target.id, target.avatarId, size);
    return { avatarId: target.avatarId, ...opened };
  }

  private changeCount(userId: string, day: string): number {
    const cur = this.changes.get(userId);
    return cur && cur.day === day ? cur.count : 0;
  }

  /** 오늘 더 바꿀 수 있는지 본다. 사용자 시간대의 오늘 날짜를 돌려준다 */
  private assertChangeAllowed(user: User, now: Date): string {
    const day = todayIn(user.timezone, now);
    if (this.changeCount(user.id, day) >= AVATAR_MAX_CHANGES_PER_DAY) {
      this.log.warn(`avatar change limit reached: user=${user.id}`);
      throw unprocessable(
        'PHOTO_DAILY_LIMIT',
        `at most ${AVATAR_MAX_CHANGES_PER_DAY} profile photo changes per day`,
      );
    }
    return day;
  }

  /** 바꾸기 횟수를 비운다(테스트) */
  resetChangeCounts(): void {
    this.changes.clear();
  }
}
