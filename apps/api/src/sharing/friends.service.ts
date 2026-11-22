import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, type FriendInvite, type FriendLink, type User } from '@prisma/client';
import {
  FRIEND_INVITE_MAX_ACTIVE,
  FRIEND_INVITE_TTL_DAYS,
  FRIEND_MAX,
  todayIn,
} from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import { unprocessable } from '../common/errors';
import { addDays, fromDbDate, toDbDate } from '../domain/dates';
import { MealsService } from '../meals/meals.service';
import type { MealRecordDto } from '../meals/meals.dto';
import { friendPair, ownerShares, SharingAccessService } from './sharing-access.service';
import { SocialService } from './social.service';
import { SocialNotifyService } from './social-notify.service';
import type { RecordSocialDto } from './social.dto';
import {
  BlockedUserDto,
  FriendDto,
  FriendInviteDto,
  FriendInvitePreviewDto,
  SharedDayDto,
  SharedMealDto,
  SharedWeightDto,
  SharingSettingsDto,
  UpdateFriendDto,
  UpdateSharingSettingsDto,
} from './sharing.dto';

type Db = Prisma.TransactionClient | PrismaService;
type LinkWithUsers = FriendLink & { userLow: User; userHigh: User };

/** 초대 코드 형식. 형식이 아니면 조회하지 않고 404 */
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * 끼니 공유 — 친구 맺기와 친구의 하루 (sharing-plan, DEC-066·090, 공유-1a).
 * 남의 데이터를 읽는 메서드(sharedDay·photoOwner·목록의 오늘 요약)는 모두 접근 판정을 거친 owner 로만 읽는다.
 */
@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SharingAccessService,
    private readonly meals: MealsService,
    private readonly social: SocialService,
    private readonly notify: SocialNotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------- 공개 범위 ----------

  getSharing(user: User): SharingSettingsDto {
    return { visibility: user.shareVisibility, shareWeight: user.shareWeight };
  }

  async setSharing(user: User, dto: UpdateSharingSettingsDto): Promise<SharingSettingsDto> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { shareVisibility: dto.visibility, shareWeight: dto.shareWeight },
    });
    return this.getSharing(updated);
  }

  // ---------- 초대 링크 ----------

  async createInvite(user: User, now: Date = new Date()): Promise<FriendInviteDto> {
    const invite = await this.prisma.$transaction(async (tx) => {
      // 같은 사용자의 동시 생성을 줄 세워 상한을 넘지 못하게 한다
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR NO KEY UPDATE`;
      const active = await this.activeInvites(tx, user.id, now);
      if (active.length >= FRIEND_INVITE_MAX_ACTIVE) {
        throw unprocessable(
          'FRIEND_INVITE_LIMIT',
          `at most ${FRIEND_INVITE_MAX_ACTIVE} active invites`,
        );
      }
      return tx.friendInvite.create({
        data: {
          userId: user.id,
          // 120비트 랜덤: 열거할 수 없다
          code: randomBytes(15).toString('base64url'),
          expiresAt: new Date(now.getTime() + FRIEND_INVITE_TTL_DAYS * 86_400_000),
        },
      });
    });
    return FriendInviteDto.from(invite, this.env.WEB_ORIGIN);
  }

  async listInvites(user: User, now: Date = new Date()): Promise<FriendInviteDto[]> {
    const rows = await this.activeInvites(this.prisma, user.id, now);
    return rows.map((r) => FriendInviteDto.from(r, this.env.WEB_ORIGIN));
  }

  /** 로그인 없이 보는 미리보기. 없는 코드·만료·소진·철회·초대자 탈퇴는 모두 404 */
  async previewInvite(code: string, now: Date = new Date()): Promise<FriendInvitePreviewDto> {
    const invite = await this.loadUsableInvite(this.prisma, code, now);
    return { nickname: invite.user.nickname };
  }

  async revokeInvite(user: User, id: string): Promise<void> {
    const r = await this.prisma.friendInvite.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw new NotFoundException();
  }

  /** 수락 즉시 친구가 된다. 공개 범위는 건드리지 않는다(각자 `PUT /me/sharing` 으로 켠다) */
  async acceptInvite(user: User, code: string, now: Date = new Date()): Promise<FriendDto> {
    let link: LinkWithUsers;
    try {
      link = await this.prisma.$transaction(async (tx) => {
        const invite = await this.loadUsableInvite(tx, code, now);
        if (invite.userId === user.id) {
          throw unprocessable('FRIEND_INVITE_OWN', 'cannot accept your own invite');
        }
        const pair = friendPair(user.id, invite.userId);
        const existing = await tx.friendLink.findUnique({ where: { userLowId_userHighId: pair } });
        if (existing?.status === 'accepted') {
          throw unprocessable('FRIEND_ALREADY', 'already friends');
        }
        // 차단 관계는 링크가 없는 것과 같은 응답 (sharing-plan §9-4)
        if (existing?.status === 'blocked') throw new NotFoundException();
        for (const id of [user.id, invite.userId]) {
          if ((await this.countFriends(tx, id)) >= FRIEND_MAX) {
            throw unprocessable('FRIEND_LIMIT', `at most ${FRIEND_MAX} friends`);
          }
        }
        // 사용 횟수를 조건부로 올려 선점한다: 동시에 두 사람이 1회용 링크를 쓰면 한쪽만 통과한다
        const claimed = await tx.friendInvite.updateMany({
          where: {
            id: invite.id,
            revokedAt: null,
            expiresAt: { gt: now },
            usedCount: { lt: tx.friendInvite.fields.maxUses },
          },
          data: { usedCount: { increment: 1 } },
        });
        if (claimed.count === 0) throw new NotFoundException();
        // 몸무게 스위치는 친구가 될 때마다 꺼진 채로 시작한다 (DEC-101)
        const data = {
          status: 'accepted' as const,
          requestedBy: invite.userId,
          respondedAt: now,
          lowSharesWeightToHigh: false,
          highSharesWeightToLow: false,
        };
        return existing
          ? tx.friendLink.update({
              where: { id: existing.id },
              data,
              include: { userLow: true, userHigh: true },
            })
          : tx.friendLink.create({
              data: { ...pair, ...data },
              include: { userLow: true, userHigh: true },
            });
      });
    } catch (e) {
      // 같은 두 사람이 서로의 링크를 동시에 수락한 경우: 유니크가 한쪽을 막는다
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw unprocessable('FRIEND_ALREADY', 'already friends');
      }
      throw e;
    }
    // 초대 링크를 만든 사람에게 알린다 (DEC-096)
    this.notify.friendAccepted(user, link.requestedBy);
    return this.toFriend(user, link);
  }

  // ---------- 친구 ----------

  async listFriends(user: User): Promise<FriendDto[]> {
    const links = await this.prisma.friendLink.findMany({
      where: { status: 'accepted', OR: [{ userLowId: user.id }, { userHighId: user.id }] },
      include: { userLow: true, userHigh: true },
    });
    const friends: FriendDto[] = [];
    for (const link of links) {
      // 탈퇴한 사용자는 목록에서 빠진다
      if (this.other(user, link).deletedAt !== null) continue;
      friends.push(await this.toFriend(user, link));
    }
    return friends.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  }

  async unfriend(user: User, otherId: string): Promise<void> {
    const r = await this.prisma.friendLink.deleteMany({
      where: { ...friendPair(user.id, otherId), status: 'accepted' },
    });
    if (r.count === 0) throw new NotFoundException();
  }

  // ---------- 차단 (DEC-097) ----------

  /**
   * 친구를 차단한다: 관계 행을 blocked 로 바꿔 친구가 끊기고, 상대는 내 초대 링크로 다시 친구가 될 수 없다.
   * 차단할 수 있는 건 지금 친구인 사람뿐이다. 이미 내가 차단했으면 그대로 성공, 그 밖(친구 아님·상대가 나를 차단함)은 404.
   * 상대에게 알리지 않으며, 상대 쪽에서는 친구 끊기와 똑같이 보인다.
   */
  async block(user: User, otherId: string, now: Date = new Date()): Promise<void> {
    const pair = friendPair(user.id, otherId);
    const r = await this.prisma.friendLink.updateMany({
      where: { ...pair, status: 'accepted' },
      data: { status: 'blocked', blockedBy: user.id, respondedAt: now },
    });
    if (r.count > 0) return;
    const already = await this.prisma.friendLink.count({
      where: { ...pair, status: 'blocked', blockedBy: user.id },
    });
    if (already === 0) throw new NotFoundException();
  }

  /** 차단 해제 = 관계 행 삭제. 친구로 돌아가지 않으며 다시 친구가 되려면 초대 링크가 필요하다 */
  async unblock(user: User, otherId: string): Promise<void> {
    const r = await this.prisma.friendLink.deleteMany({
      where: { ...friendPair(user.id, otherId), status: 'blocked', blockedBy: user.id },
    });
    if (r.count === 0) throw new NotFoundException();
  }

  /**
   * 내가 차단한 사람, 닉네임 순. 나를 차단한 사람은 싣지 않는다.
   * 탈퇴 대기 중인 사람도 싣는다: 해제할 곳이 여기뿐이다(완전 삭제되면 행이 CASCADE 로 사라진다).
   */
  async listBlocked(user: User): Promise<BlockedUserDto[]> {
    const links = await this.prisma.friendLink.findMany({
      where: { status: 'blocked', blockedBy: user.id },
      include: { userLow: true, userHigh: true },
    });
    return links
      .map((l) => this.other(user, l))
      .map((u) => ({ userId: u.id, nickname: u.nickname }))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  }

  /** 이 친구에게만 내 끼니를 끄거나 켜고, 내 몸무게를 켜거나 끈다(방향 플래그). 보내지 않은 쪽은 그대로 */
  async updateFriend(user: User, otherId: string, dto: UpdateFriendDto): Promise<FriendDto> {
    const pair = friendPair(user.id, otherId);
    const iAmLow = pair.userLowId === user.id;
    // 끼니를 끄면 몸무게도 끈다: 나중에 끼니만 다시 켰을 때 몸무게가 따라 켜지지 않게 (DEC-101)
    const weight = dto.shareToFriend === false ? false : dto.shareWeightToFriend;
    const r = await this.prisma.friendLink.updateMany({
      where: { ...pair, status: 'accepted' },
      data: iAmLow
        ? { lowSharesToHigh: dto.shareToFriend, lowSharesWeightToHigh: weight }
        : { highSharesToLow: dto.shareToFriend, highSharesWeightToLow: weight },
    });
    if (r.count === 0) throw new NotFoundException();
    const link = await this.prisma.friendLink.findUnique({
      where: { userLowId_userHighId: pair },
      include: { userLow: true, userHigh: true },
    });
    if (!link) throw new NotFoundException();
    return this.toFriend(user, link);
  }

  // ---------- 친구의 하루 ----------

  /** 접근 불가·미래·가입 전은 모두 404. 가입일부터 오늘(친구 시간대)까지는 어느 날이든 본다 (§9-3) */
  async sharedDay(viewer: User, ownerId: string, date: string): Promise<SharedDayDto> {
    const { owner, weight } = await this.access.resolveViewableWithScope(viewer.id, ownerId);
    const today = todayIn(owner.timezone);
    const firstDate = todayIn(owner.timezone, owner.createdAt);
    if (date > today || date < firstDate) throw new NotFoundException();
    const day = await this.meals.getDayForSharing(owner, date);
    // 미기록 자유 끼니는 숨긴다 (D-18)
    const slots = day.slots
      .filter((s) => !(s.record.status === 'unrecorded' && s.planType === 'none'))
      .map((s) => s.record);
    const social = await this.social.summaries(
      viewer.id,
      owner.id,
      [...slots, ...day.extras]
        .filter((r) => r.id !== null && r.status !== 'unrecorded')
        .map((r) => r.id as string),
    );
    return {
      owner: { userId: owner.id, nickname: owner.nickname, avatarId: owner.avatarId },
      date,
      today,
      firstDate,
      slots: slots.map((r) => sharedMeal(r, social)),
      extras: day.extras.map((r) => sharedMeal(r, social)),
      nutrition: day.recorded,
      completed: day.completed,
      weight: weight ? await this.sharedWeight(owner, date, firstDate) : null,
    };
  }

  /**
   * 친구에게 보이는 몸무게 (DEC-101): 그날 값 + 그날을 끝으로 하는 7일. 가입일 앞은 자른다.
   * 접근 판정이 몸무게 공개를 확인한 owner 로만 부른다. 목표 체중·변화량은 읽지 않는다.
   */
  private async sharedWeight(
    owner: User,
    date: string,
    firstDate: string,
  ): Promise<SharedWeightDto> {
    const weekAgo = addDays(date, -6);
    const from = weekAgo < firstDate ? firstDate : weekAgo;
    const rows = await this.prisma.weightRecord.findMany({
      where: { userId: owner.id, onDate: { gte: toDbDate(from), lte: toDbDate(date) } },
    });
    const byDate = new Map(rows.map((r) => [fromDbDate(r.onDate), r.weightKg.toNumber()]));
    const recent: SharedWeightDto['recent'] = [];
    for (let d = from; d <= date; d = addDays(d, 1)) {
      recent.push({ date: d, weightKg: byDate.get(d) ?? null });
    }
    return { weightKg: byDate.get(date) ?? null, recent };
  }

  /** 친구의 사진을 열 수 있는 owner. 사진 자체의 조건(기록에 붙음·삭제·만료)은 PhotosService 가 본다 */
  photoOwner(viewer: User, ownerId: string): Promise<User> {
    return this.access.resolveViewable(viewer.id, ownerId);
  }

  // ---------- 내부 ----------

  private other(user: User, link: LinkWithUsers): User {
    return link.userLowId === user.id ? link.userHigh : link.userLow;
  }

  private async toFriend(user: User, link: LinkWithUsers): Promise<FriendDto> {
    const friend = this.other(user, link);
    const iAmLow = link.userLowId === user.id;
    const shared = ownerShares(link, friend);
    let today: FriendDto['today'] = null;
    if (shared) {
      const date = todayIn(friend.timezone);
      const [summary] = await this.meals.getDays(friend, date, date);
      if (summary) {
        today = {
          date,
          activeSlots: summary.activeSlots,
          recordedSlots: summary.recordedSlots,
          completed: summary.completed,
        };
      }
    }
    return {
      userId: friend.id,
      nickname: friend.nickname,
      statusMessage: friend.statusMessage,
      avatarId: friend.avatarId,
      since: (link.respondedAt ?? link.createdAt).toISOString(),
      shareToFriend: iAmLow ? link.lowSharesToHigh : link.highSharesToLow,
      shareWeightToFriend: iAmLow ? link.lowSharesWeightToHigh : link.highSharesWeightToLow,
      shared,
      today,
    };
  }

  private countFriends(db: Db, userId: string): Promise<number> {
    return db.friendLink.count({
      where: { status: 'accepted', OR: [{ userLowId: userId }, { userHighId: userId }] },
    });
  }

  /** 아직 쓸 수 있는 내 링크(철회 안 됨·만료 전·남은 횟수 있음), 만든 순 */
  private async activeInvites(db: Db, userId: string, now: Date): Promise<FriendInvite[]> {
    const rows = await db.friendInvite.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter((r) => r.usedCount < r.maxUses);
  }

  private async loadUsableInvite(
    db: Db,
    code: string,
    now: Date,
  ): Promise<FriendInvite & { user: User }> {
    if (!INVITE_CODE_RE.test(code)) throw new NotFoundException();
    const invite = await db.friendInvite.findUnique({ where: { code }, include: { user: true } });
    if (
      !invite ||
      invite.revokedAt !== null ||
      invite.expiresAt.getTime() <= now.getTime() ||
      invite.usedCount >= invite.maxUses ||
      invite.user.deletedAt !== null
    ) {
      throw new NotFoundException();
    }
    return invite;
  }
}

/** 공유할 필드만 고른다. 먹었음이 아닌 끼니는 상태만 보이고 계획 품목은 싣지 않는다 */
function sharedMeal(r: MealRecordDto, social: Map<string, RecordSocialDto>): SharedMealDto {
  const eaten = r.status === 'eaten';
  return {
    recordId: r.id,
    slot: r.slot,
    status: r.status,
    kind: r.kind,
    outsideMenus: eaten ? r.outsideItems.map((o) => o.name) : [],
    items: eaten
      ? r.items.map((i) => ({
          name: i.productName,
          quantity: i.actualQuantity,
          unit: i.unit,
          displayUnit: i.displayUnit,
        }))
      : [],
    photos: eaten
      ? r.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, expired: p.expired }))
      : [],
    social: (r.id ? social.get(r.id) : undefined) ?? null,
  };
}
