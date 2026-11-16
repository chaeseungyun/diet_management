import { Injectable, NotFoundException } from '@nestjs/common';
import type { FriendLink, User } from '@prisma/client';
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
 * 끼니 공유의 접근 판정 (sharing-plan §3, DEC-066·090).
 * 사용자 격리(NFR-04)의 유일한 예외다: 남의 데이터를 읽는 코드는 반드시 여기서 owner 를 받아서만 읽는다.
 * 판정 실패는 이유(없는 사용자·친구 아님·비공개·친구별 끄기·탈퇴)와 무관하게 같은 404 다 (D-06).
 */
@Injectable()
export class SharingAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveViewable(viewerId: string, ownerId: string): Promise<User> {
    if (viewerId === ownerId) throw new NotFoundException();
    const link = await this.prisma.friendLink.findUnique({
      where: { userLowId_userHighId: friendPair(viewerId, ownerId) },
      include: { userLow: true, userHigh: true },
    });
    if (!link) throw new NotFoundException();
    const owner = link.userLowId === ownerId ? link.userLow : link.userHigh;
    if (!ownerShares(link, owner)) throw new NotFoundException();
    return owner;
  }
}
