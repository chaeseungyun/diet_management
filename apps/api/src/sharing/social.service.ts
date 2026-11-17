import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { COMMENT_MAX_PER_RECORD, REACTION_EMOJIS, type ReactionEmoji } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { unprocessable } from '../common/errors';
import { toDbDate } from '../domain/dates';
import { SharingAccessService } from './sharing-access.service';
import { SocialNotifyService } from './social-notify.service';
import { CommentDto, CommentLikeDto, RecordSocialDto } from './social.dto';

/**
 * 끼니 반응·댓글·댓글 좋아요 (sharing-plan §3·§6, DEC-092, 공유-2a).
 * 소유자가 아닌 사용자가 쓰는 유일한 테이블들이다. 모든 읽기·쓰기는 `SharingAccessService.resolveRecord` 가
 * 돌려준 기록에만 한다. 기록이 미기록으로 돌아가면 MealsService 의 쓰기 트랜잭션이 셋을 함께 지운다.
 */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SharingAccessService,
    private readonly notify: SocialNotifyService,
  ) {}

  /** 기록들의 반응 집계·내 반응·댓글 수. 접근 판정은 부르는 쪽이 끝낸 기록 id 만 넘긴다 */
  async summaries(viewerId: string, recordIds: string[]): Promise<Map<string, RecordSocialDto>> {
    const out = new Map<string, RecordSocialDto>(
      recordIds.map((id) => [
        id,
        { recordId: id, reactions: [], myReaction: null, commentCount: 0 },
      ]),
    );
    if (recordIds.length === 0) return out;
    // 탈퇴(삭제 대기)한 사용자가 남긴 것은 세지 않는다
    const alive = { user: { deletedAt: null } };
    const [reactions, comments] = await Promise.all([
      this.prisma.mealReaction.findMany({
        where: { mealRecordId: { in: recordIds }, ...alive },
        select: { mealRecordId: true, userId: true, emoji: true },
      }),
      this.prisma.mealComment.groupBy({
        by: ['mealRecordId'],
        where: { mealRecordId: { in: recordIds }, ...alive },
        _count: { _all: true },
      }),
    ]);
    for (const r of reactions) {
      const s = out.get(r.mealRecordId)!;
      if (r.userId === viewerId) s.myReaction = r.emoji;
      const hit = s.reactions.find((x) => x.emoji === r.emoji);
      if (hit) hit.count += 1;
      else s.reactions.push({ emoji: r.emoji, count: 1 });
    }
    const order = (e: string) => REACTION_EMOJIS.indexOf(e as ReactionEmoji);
    for (const s of out.values()) s.reactions.sort((a, b) => order(a.emoji) - order(b.emoji));
    for (const c of comments) out.get(c.mealRecordId)!.commentCount = c._count._all;
    return out;
  }

  /** 내 하루의 기록별 반응·댓글 수 (오늘 화면 카드용) */
  async myDay(user: User, date: string): Promise<RecordSocialDto[]> {
    const records = await this.prisma.mealRecord.findMany({
      where: { userId: user.id, mealDate: toDbDate(date), status: { not: 'unrecorded' } },
      select: { id: true },
    });
    return [
      ...(
        await this.summaries(
          user.id,
          records.map((r) => r.id),
        )
      ).values(),
    ];
  }

  // ---------- 반응: 친구만, 기록당 한 사람 1개 ----------

  async setReaction(
    viewer: User,
    ownerId: string,
    recordId: string,
    emoji: string,
  ): Promise<RecordSocialDto> {
    const { record } = await this.access.resolveRecord(viewer, ownerId, recordId, {
      allowOwner: false,
    });
    await this.prisma.mealReaction.upsert({
      where: { mealRecordId_userId: { mealRecordId: record.id, userId: viewer.id } },
      create: { mealRecordId: record.id, userId: viewer.id, emoji },
      update: { emoji },
    });
    this.notify.reaction(viewer, record, emoji);
    return this.one(viewer.id, record.id);
  }

  async clearReaction(viewer: User, ownerId: string, recordId: string): Promise<RecordSocialDto> {
    const { record } = await this.access.resolveRecord(viewer, ownerId, recordId, {
      allowOwner: false,
    });
    await this.prisma.mealReaction.deleteMany({
      where: { mealRecordId: record.id, userId: viewer.id },
    });
    return this.one(viewer.id, record.id);
  }

  // ---------- 댓글: 볼 수 있는 친구와 기록 소유자 ----------

  async listComments(viewer: User, ownerId: string, recordId: string): Promise<CommentDto[]> {
    const { owner, record } = await this.access.resolveRecord(viewer, ownerId, recordId, {
      allowOwner: true,
    });
    const rows = await this.prisma.mealComment.findMany({
      where: { mealRecordId: record.id, user: { deletedAt: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        user: { select: { nickname: true } },
        _count: { select: { likes: true } },
        likes: { where: { userId: viewer.id }, select: { userId: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      userId: c.userId,
      nickname: c.user.nickname,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      likeCount: c._count.likes,
      likedByMe: c.likes.length > 0,
      mine: c.userId === viewer.id,
      canDelete: c.userId === viewer.id || owner.id === viewer.id,
    }));
  }

  async addComment(
    viewer: User,
    ownerId: string,
    recordId: string,
    body: string,
  ): Promise<CommentDto[]> {
    const { record } = await this.access.resolveRecord(viewer, ownerId, recordId, {
      allowOwner: true,
    });
    const count = await this.prisma.mealComment.count({ where: { mealRecordId: record.id } });
    if (count >= COMMENT_MAX_PER_RECORD) {
      throw unprocessable('COMMENT_LIMIT', `at most ${COMMENT_MAX_PER_RECORD} comments per record`);
    }
    const comment = await this.prisma.mealComment.create({
      data: { mealRecordId: record.id, userId: viewer.id, body },
    });
    this.notify.comment(viewer, record, comment);
    return this.listComments(viewer, ownerId, recordId);
  }

  /** 쓴 사람 또는 기록 소유자만 지운다. 그 밖에는 404 */
  async deleteComment(
    viewer: User,
    ownerId: string,
    recordId: string,
    commentId: string,
  ): Promise<void> {
    const { owner, record } = await this.access.resolveRecord(viewer, ownerId, recordId, {
      allowOwner: true,
    });
    const r = await this.prisma.mealComment.deleteMany({
      where: {
        id: commentId,
        mealRecordId: record.id,
        ...(owner.id === viewer.id ? {} : { userId: viewer.id }),
      },
    });
    if (r.count === 0) throw new NotFoundException();
  }

  // ---------- 댓글 좋아요: 그 댓글이 달린 기록을 볼 수 있는 사람 ----------

  async setLike(viewer: User, commentId: string, liked: boolean): Promise<CommentLikeDto> {
    const comment = await this.prisma.mealComment.findUnique({
      where: { id: commentId },
      select: { id: true, mealRecordId: true, mealRecord: { select: { userId: true } } },
    });
    if (!comment) throw new NotFoundException();
    // 댓글 id 만으로 들어오므로 기록의 소유자를 찾아 같은 판정을 다시 거친다
    await this.access.resolveRecord(viewer, comment.mealRecord.userId, comment.mealRecordId, {
      allowOwner: true,
    });
    if (liked) {
      // 다시 눌러도 행은 하나 (PK)
      await this.prisma.commentLike.createMany({
        data: [{ commentId, userId: viewer.id }],
        skipDuplicates: true,
      });
      this.notify.commentLike(viewer, commentId);
    } else {
      await this.prisma.commentLike.deleteMany({ where: { commentId, userId: viewer.id } });
    }
    const likeCount = await this.prisma.commentLike.count({ where: { commentId } });
    return { likeCount, likedByMe: liked };
  }

  private async one(viewerId: string, recordId: string): Promise<RecordSocialDto> {
    return (await this.summaries(viewerId, [recordId])).get(recordId)!;
  }
}
