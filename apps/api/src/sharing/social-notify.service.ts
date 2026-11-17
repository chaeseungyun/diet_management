import { Injectable, Logger } from '@nestjs/common';
import type { MealRecord, User } from '@prisma/client';
import { SLOT_LABELS, todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, type DateString } from '../domain/dates';
import { NotificationScheduler, type Claim } from '../notifications/notification-scheduler';
import type { PushPayload } from '../notifications/push-sender';
import { SharingAccessService } from './sharing-access.service';

/** 푸시 본문에 싣는 댓글 길이 */
const BODY_PREVIEW = 80;

function preview(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > BODY_PREVIEW ? `${one.slice(0, BODY_PREVIEW - 1)}…` : one;
}

/** '11월 17일 점심' */
function mealLabel(record: Pick<MealRecord, 'mealDate' | 'slot'>): string {
  const [, m, d] = fromDbDate(record.mealDate).split('-').map(Number);
  return `${m}월 ${d}일 ${SLOT_LABELS[record.slot]}`;
}

/**
 * 친구 소식 알림 (공유-2b, DEC-096): 반응·댓글·댓글 좋아요·친구 수락.
 * 요청을 처리한 쪽(SocialService·FriendsService)이 쓰기를 끝낸 뒤 부른다. 발송은 기다리지 않고 뒤에서 하며,
 * 실패는 로그만 남기고 요청에 영향을 주지 않는다. 중복은 발송 기록의 유니크가 막는다.
 * 받는 사람은 지금 그 끼니를 볼 수 있는 사람만이고, 한 일을 한 본인과 한 사람과 차단 관계인 사람은 받지 않는다.
 */
@Injectable()
export class SocialNotifyService {
  private readonly log = new Logger(SocialNotifyService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SharingAccessService,
    private readonly scheduler: NotificationScheduler,
  ) {}

  /** 테스트용: 뒤에서 보내는 중인 알림이 모두 끝날 때까지 기다린다 */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /** 기록 주인에게. 같은 사람·같은 끼니는 한 번만(반응을 바꾸거나 다시 눌러도) */
  reaction(actor: User, record: MealRecord, emoji: string): void {
    this.fire(() =>
      this.send(record.userId, {
        type: 'friend_reaction',
        targetDate: fromDbDate(record.mealDate),
        targetKey: `${record.id}:${actor.id}`,
        slot: record.slot,
        seq: 0,
        scheduledAt: new Date(),
        payload: {
          title: `${actor.nickname}님이 ${mealLabel(record)}에 ${emoji} 반응했어요`,
          body: '눌러서 보기',
          url: this.ownerUrl(record),
          tag: `reaction-${record.id}-${actor.id}`,
        },
      }),
    );
  }

  /**
   * 기록 주인과 그 끼니에 먼저 댓글을 단 사람들에게, 댓글마다.
   * 먼저 단 친구는 지금도 그 끼니를 볼 수 있을 때만 받는다. 같은 끼니의 댓글 알림은 폰에서 덮어쓴다(tag).
   */
  comment(actor: User, record: MealRecord, comment: { id: string; body: string }): void {
    this.fire(async () => {
      const earlier = await this.prisma.mealComment.findMany({
        where: { mealRecordId: record.id, userId: { notIn: [actor.id, record.userId] } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const recipients = [
        ...(actor.id === record.userId ? [] : [record.userId]),
        ...earlier.map((c) => c.userId),
      ];
      const blocked = new Set(await this.access.blockedWith(actor.id));
      for (const userId of recipients) {
        // 차단 관계인 사람에게는 보내지 않는다(DEC-097). 주인은 actor 가 볼 수 있으니 차단일 수 없다
        if (blocked.has(userId)) continue;
        if (userId !== record.userId && !(await this.canView(userId, record.userId))) continue;
        await this.send(userId, {
          type: 'friend_comment',
          targetDate: fromDbDate(record.mealDate),
          targetKey: comment.id,
          slot: record.slot,
          seq: 0,
          scheduledAt: new Date(),
          payload: {
            title: `${actor.nickname}님의 댓글 · ${mealLabel(record)}`,
            body: preview(comment.body),
            url: this.commentsUrl(userId, record),
            tag: `comment-${record.id}`,
          },
        });
      }
    });
  }

  /** 댓글을 쓴 사람에게. 같은 사람·같은 댓글은 한 번만 */
  commentLike(actor: User, commentId: string): void {
    this.fire(async () => {
      const comment = await this.prisma.mealComment.findUnique({
        where: { id: commentId },
        include: { mealRecord: true },
      });
      if (!comment || comment.userId === actor.id) return;
      if (await this.access.isBlocked(actor.id, comment.userId)) return;
      const record = comment.mealRecord;
      if (
        comment.userId !== record.userId &&
        !(await this.canView(comment.userId, record.userId))
      ) {
        return;
      }
      await this.send(comment.userId, {
        type: 'comment_like',
        targetDate: fromDbDate(record.mealDate),
        targetKey: `${comment.id}:${actor.id}`,
        slot: record.slot,
        seq: 0,
        scheduledAt: new Date(),
        payload: {
          title: `${actor.nickname}님이 내 댓글을 좋아해요`,
          body: preview(comment.body),
          url: this.commentsUrl(comment.userId, record),
          tag: `like-${comment.id}-${actor.id}`,
        },
      });
    });
  }

  /** 초대 링크를 만든 사람에게 */
  friendAccepted(accepter: User, inviterId: string): void {
    this.fire(async () => {
      const inviter = await this.prisma.user.findUnique({
        where: { id: inviterId },
        select: { timezone: true },
      });
      if (!inviter) return;
      await this.send(inviterId, {
        type: 'friend_accepted',
        targetDate: todayIn(inviter.timezone) as DateString,
        targetKey: accepter.id,
        slot: null,
        seq: 0,
        scheduledAt: new Date(),
        payload: {
          title: `${accepter.nickname}님과 친구가 됐어요`,
          body: '눌러서 친구 보기',
          url: '/friends',
          tag: `friend-${accepter.id}`,
        },
      });
    });
  }

  private ownerUrl(record: MealRecord): string {
    return `/day/${fromDbDate(record.mealDate)}`;
  }

  /** 누르면 그 끼니의 댓글 창이 열리는 경로. 주인은 내 하루, 친구는 친구의 하루 */
  private commentsUrl(recipientId: string, record: MealRecord): string {
    const day =
      recipientId === record.userId
        ? this.ownerUrl(record)
        : `/friends/${record.userId}/day/${fromDbDate(record.mealDate)}`;
    return `${day}?comments=${record.id}`;
  }

  private async canView(viewerId: string, ownerId: string): Promise<boolean> {
    try {
      await this.access.resolveViewable(viewerId, ownerId);
      return true;
    } catch {
      return false;
    }
  }

  private async send(userId: string, claim: Claim & { payload: PushPayload }): Promise<void> {
    await this.scheduler.sendNow(userId, 'social', claim);
  }

  private fire(job: () => Promise<void>): void {
    const p: Promise<void> = job()
      .catch((e: unknown) => {
        this.log.error(`social notify failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }
}
