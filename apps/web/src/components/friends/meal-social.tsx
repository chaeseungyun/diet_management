'use client';

import { useEffect, useState } from 'react';
import { Heart, Loader2, MessageCircle, Send, Trash2 } from 'lucide-react';
import { COMMENT_MAX_LENGTH, REACTION_EMOJIS } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, describeError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { ProfileButton } from './profile-sheet';

export type RecordSocial = Schemas['RecordSocialDto'];
type Comment = Schemas['CommentDto'];

/** 볼 수 없게 된 기록(비공개·친구 끊김·미기록으로 되돌림)에 대한 안내 */
const GONE = { messages: { NOT_FOUND: '지금은 이 끼니를 볼 수 없어요. 화면을 새로 고쳐 주세요.' } };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const hm = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

/**
 * 끼니 카드 아래의 반응 줄과 댓글 (S-83·S-86, DEC-092).
 * canReact(친구의 끼니)면 이모지 6개를 눌러 반응하고, 내 끼니면 받은 반응만 보인다. 댓글은 양쪽 다 쓴다.
 * 카드 맨 아래에 구분선을 두고 붙인다(기록 버튼과 떨어뜨림, DEC-094).
 */
export function MealSocial({
  ownerId,
  social: initial,
  canReact,
  className,
}: {
  /** 기록의 소유자. 내 끼니면 내 id */
  ownerId: string;
  social: RecordSocial;
  canReact: boolean;
  className?: string;
}) {
  const { status, set } = useStatus();
  const [social, setSocial] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const base = `/friends/${ownerId}/meal-records/${social.recordId}`;

  // 화면을 새로 고쳐 서버 값이 바뀌면 따라간다
  useEffect(() => setSocial(initial), [initial]);

  // 댓글 알림을 누르고 들어오면(?comments=기록id) 그 끼니의 댓글 창을 연다 (DEC-096).
  // 연 뒤에는 주소에서 지워 새로 고침해도 다시 열리지 않게 한다
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('comments') !== initial.recordId) return;
    setOpen(true);
    url.searchParams.delete('comments');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, [initial.recordId]);

  async function react(emoji: string) {
    setBusy(true);
    try {
      const next =
        social.myReaction === emoji
          ? await api<RecordSocial>('DELETE', `${base}/reaction`)
          : await api<RecordSocial>('PUT', `${base}/reaction`, { emoji });
      setSocial(next);
      set({ kind: 'idle' });
    } catch (e) {
      set({ kind: 'error', message: describeError(e, GONE) });
    } finally {
      setBusy(false);
    }
  }

  const count = (emoji: string) => social.reactions.find((r) => r.emoji === emoji)?.count ?? 0;
  const chip = 'inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-sm';

  return (
    <div className={cn('flex flex-col gap-2 border-t border-border pt-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {canReact
          ? REACTION_EMOJIS.map((emoji) => {
              const mine = social.myReaction === emoji;
              const n = count(emoji);
              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  aria-pressed={mine}
                  aria-label={`${emoji} 반응${mine ? ' 취소' : ''}${n > 0 ? `, ${n}명` : ''}`}
                  onClick={() => react(emoji)}
                  className={cn(
                    chip,
                    'disabled:opacity-60',
                    mine
                      ? 'border-transparent bg-accent text-accent-foreground'
                      : 'border-border hover:bg-accent/50',
                    n === 0 && !mine && 'opacity-60',
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                  {n > 0 ? <span className="text-xs">{n}</span> : null}
                </button>
              );
            })
          : social.reactions.map((r) => (
              <span key={r.emoji} className={cn(chip, 'border-border')}>
                <span aria-hidden>{r.emoji}</span>
                <span className="text-xs">{r.count}</span>
              </span>
            ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(chip, 'ml-auto border-border text-muted-foreground hover:bg-accent/50')}
        >
          <MessageCircle className="size-4" />
          <span className="text-xs">
            {social.commentCount > 0 ? `댓글 ${social.commentCount}` : '댓글'}
          </span>
        </button>
      </div>
      <StatusBanner status={status} />
      <Dialog open={open} onClose={() => setOpen(false)} title="댓글">
        {open ? (
          <Comments
            base={base}
            onCount={(n) => setSocial((cur) => ({ ...cur, commentCount: n }))}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/** S-86 댓글 시트: 목록(오래된 순)·좋아요·삭제·쓰기. 열 때마다 새로 불러온다 */
function Comments({ base, onCount }: { base: string; onCount: (n: number) => void }) {
  const { status, set } = useStatus();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // 삭제는 한 번 더 묻는다: 확인 중인 댓글 id
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const apply = (next: Comment[]) => {
    setComments(next);
    onCount(next.length);
  };
  const fail = (e: unknown) => set({ kind: 'error', message: describeError(e, GONE) });

  useEffect(() => {
    let alive = true;
    api<Comment[]>('GET', `${base}/comments`)
      .then((list) => alive && apply(list))
      .catch((e: unknown) => alive && fail(e));
    return () => {
      alive = false;
    };
    // base 가 바뀔 때만 다시 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      apply(await api<Comment[]>('POST', `${base}/comments`, { body: text }));
      setBody('');
      set({ kind: 'idle' });
    } catch (e) {
      // 쓰던 내용은 남긴다
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    setBusy(true);
    try {
      await api('DELETE', `${base}/comments/${c.id}`);
      apply((comments ?? []).filter((x) => x.id !== c.id));
      set({ kind: 'idle' });
    } catch (e) {
      fail(e);
    } finally {
      setConfirmId(null);
      setBusy(false);
    }
  }

  async function like(c: Comment) {
    try {
      const r = await api<Schemas['CommentLikeDto']>(
        c.likedByMe ? 'DELETE' : 'PUT',
        `/comments/${c.id}/like`,
      );
      setComments((cur) => (cur ?? []).map((x) => (x.id === c.id ? { ...x, ...r } : x)));
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      {comments === null ? (
        status.kind === 'error' ? null : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 불러오는 중…
          </p>
        )
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 댓글이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-2">
              <ProfileButton
                userId={c.userId}
                nickname={c.nickname}
                avatarId={c.avatarId}
                className="size-8 text-xs"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.nickname}</span>
                  {c.mine ? ' (나)' : ''} · {timeLabel(c.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
              <button
                type="button"
                onClick={() => like(c)}
                aria-pressed={c.likedByMe}
                aria-label={c.likedByMe ? '좋아요 취소' : '좋아요'}
                className="flex shrink-0 items-center gap-1 rounded-md p-1.5 text-xs text-muted-foreground hover:bg-accent/50"
              >
                <Heart
                  className={cn('size-4', c.likedByMe && 'fill-destructive text-destructive')}
                />
                {c.likeCount > 0 ? c.likeCount : null}
              </button>
              {c.canDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmId(c.id)}
                  aria-label="댓글 삭제"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
              {confirmId === c.id ? (
                <div className="flex w-full flex-col gap-2 rounded-lg bg-muted p-3">
                  <p className="text-sm">댓글을 삭제하시겠습니까?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setConfirmId(null)}>
                      취소
                    </Button>
                    <Button variant="destructive" disabled={busy} onClick={() => remove(c)}>
                      삭제
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <StatusBanner status={status} />
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="댓글 쓰기"
          aria-label="댓글 쓰기"
          className="min-h-12 flex-1"
          rows={2}
        />
        <Button onClick={send} disabled={busy || body.trim() === ''} aria-label="댓글 보내기">
          <Send className="size-4" />
        </Button>
      </div>
    </>
  );
}
