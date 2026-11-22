import { Injectable, NotFoundException } from '@nestjs/common';
import type { FriendLink, MealRecord, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 두 사용자 id 를 (작은 쪽, 큰 쪽)으로 놓는다. friend_links 는 쌍마다 1행이다 */
export function friendPair(a: string, b: string): { userLowId: string; userHighId: string } {
  return a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a };
}

/**
 * owner 가 이 관계의 상대에게 자기 끼니를 보이는가.
 * 친구 수락 + owner 가 탈퇴하지 않음 + owner 의 공개 범위가 friends + 이 친구에게 끄지 않음, 넷 다여야 한다.
 */
export function ownerShares(link: FriendLink, owner: User): boolean {
  if (link.status !== 'accepted') return false;
  if (owner.deletedAt !== null) return false;
  if (owner.shareVisibility !== 'friends') return false;
  return link.userLowId === owner.id ? link.lowSharesToHigh : link.highSharesToLow;
}

/**
 * owner 가 이 관계의 상대에게 자기 몸무게도 보이는가 (DEC-101).
 * 끼니를 볼 수 있음 + owner 가 몸무게 공개를 켬 + 이 친구에게 몸무게를 켬, 셋 다여야 한다(둘 다 기본 꺼짐).
 */
export function ownerSharesWeight(link: FriendLink, owner: User): boolean {
  if (!ownerShares(link, owner)) return false;
  if (!owner.shareWeight) return false;
  return link.userLowId === owner.id ? link.lowSharesWeightToHigh : link.highSharesWeightToLow;
}

/**
 * 끼니 공유의 접근 판정 (sharing-plan §3, DEC-066·090).
 * 사용자 격리(NFR-04)의 유일한 예외다: 남의 데이터를 읽는 코드는 반드시 여기서 owner 를 받아서만 읽는다.
 * 판정 실패는 이유(없는 사용자·친구 아님·비공개·친구별 끄기·탈퇴·차단)와 무관하게 같은 404 다 (D-06).
 */
@Injectable()
export class SharingAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveViewable(viewerId: string, ownerId: string): Promise<User> {
    return (await this.resolveViewableWithScope(viewerId, ownerId)).owner;
  }

  /** resolveViewable 과 같은 판정에 더해, 이 viewer 에게 몸무게도 보이는지 함께 돌려준다 (DEC-101) */
  async resolveViewableWithScope(
    viewerId: string,
    ownerId: string,
  ): Promise<{ owner: User; weight: boolean }> {
    if (viewerId === ownerId) throw new NotFoundException();
    const link = await this.prisma.friendLink.findUnique({
      where: { userLowId_userHighId: friendPair(viewerId, ownerId) },
      include: { userLow: true, userHigh: true },
    });
    if (!link) throw new NotFoundException();
    const owner = link.userLowId === ownerId ? link.userLow : link.userHigh;
    if (!ownerShares(link, owner)) throw new NotFoundException();
    return { owner, weight: ownerSharesWeight(link, owner) };
  }

  /**
   * 프로필(닉네임·상태 메시지·프로필 사진)을 볼 수 있는 대상 (DEC-104).
   * 본인, 친구, 또는 같은 친구가 있는 사람(친구의 끼니 댓글창에서 서로 닉네임이 보이는 범위)만 통과한다.
   * 끼니 공개 범위와는 무관하다. 차단 관계·탈퇴·그 밖은 모두 같은 404 (D-06).
   */
  async resolveProfileViewable(
    viewer: User,
    targetId: string,
  ): Promise<{ target: User; isMe: boolean; isFriend: boolean }> {
    if (viewer.id === targetId) return { target: viewer, isMe: true, isFriend: false };
    const target = await this.prisma.user.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!target) throw new NotFoundException();
    const link = await this.prisma.friendLink.findUnique({
      where: { userLowId_userHighId: friendPair(viewer.id, targetId) },
      select: { status: true },
    });
    if (link?.status === 'blocked') throw new NotFoundException();
    if (link?.status === 'accepted') return { target, isMe: false, isFriend: true };
    // 같은 친구: 내 친구(탈퇴하지 않은) 중 target 과도 친구인 사람이 있는가
    const mine = await this.prisma.friendLink.findMany({
      where: { status: 'accepted', OR: [{ userLowId: viewer.id }, { userHighId: viewer.id }] },
      select: {
        userLow: { select: { id: true, deletedAt: true } },
        userHigh: { select: { id: true, deletedAt: true } },
      },
    });
    const friendIds = mine
      .map((l) => (l.userLow.id === viewer.id ? l.userHigh : l.userLow))
      .filter((u) => u.deletedAt === null)
      .map((u) => u.id);
    if (friendIds.length === 0) throw new NotFoundException();
    const common = await this.prisma.friendLink.count({
      where: {
        status: 'accepted',
        OR: [
          { userLowId: targetId, userHighId: { in: friendIds } },
          { userHighId: targetId, userLowId: { in: friendIds } },
        ],
      },
    });
    if (common === 0) throw new NotFoundException();
    return { target, isMe: false, isFriend: false };
  }

  /**
   * userId 와 차단 관계인 사람들(내가 차단했거나 나를 차단한 사람, DEC-097).
   * 같은 친구의 끼니에 서로 남긴 반응·댓글을 서로에게 숨기고, 서로의 알림을 막는 데 쓴다.
   */
  async blockedWith(userId: string): Promise<string[]> {
    const links = await this.prisma.friendLink.findMany({
      where: { status: 'blocked', OR: [{ userLowId: userId }, { userHighId: userId }] },
      select: { userLowId: true, userHighId: true },
    });
    return links.map((l) => (l.userLowId === userId ? l.userHighId : l.userLowId));
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const link = await this.prisma.friendLink.findUnique({
      where: { userLowId_userHighId: friendPair(a, b) },
      select: { status: true },
    });
    return link?.status === 'blocked';
  }

  /**
   * 반응·댓글이 달리는 기록 (DEC-092). viewer 가 owner 의 끼니를 볼 수 있고, 그 기록이 owner 의 것이며
   * 미기록이 아니어야 한다. allowOwner 면 소유자 본인도 통과한다(자기 끼니의 댓글 읽기·쓰기·지우기).
   * 실패는 모두 같은 404.
   */
  async resolveRecord(
    viewer: User,
    ownerId: string,
    recordId: string,
    opts: { allowOwner: boolean },
  ): Promise<{ owner: User; record: MealRecord }> {
    const owner =
      opts.allowOwner && viewer.id === ownerId
        ? viewer
        : await this.resolveViewable(viewer.id, ownerId);
    const record = await this.prisma.mealRecord.findFirst({
      where: { id: recordId, userId: owner.id, status: { not: 'unrecorded' } },
    });
    if (!record) throw new NotFoundException();
    return { owner, record };
  }
}
