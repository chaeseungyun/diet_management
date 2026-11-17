'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, MoreVertical } from 'lucide-react';
import { api } from '@/lib/client';
import { friendDayHref, friendTodayText, type Friend } from '@/lib/friends';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

/** S-80 친구 한 줄: 누르면 친구의 오늘(S-83), ⋮ 로 이 친구에게 숨기기·친구 끊기·차단(DEC-097) */
export function FriendRow({ friend }: { friend: Friend }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<'unfriend' | 'block' | null>(null);
  const [busy, setBusy] = useState(false);
  const href = friendDayHref(friend);

  async function act(work: () => Promise<unknown>, saved: string, close: boolean) {
    setBusy(true);
    try {
      await run(work, saved);
      if (close) setOpen(false);
      router.refresh();
    } catch {
      // 배너가 표시한다
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <span className="font-medium">{friend.nickname}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {friendTodayText(friend)}
        {!friend.shareToFriend ? <Badge variant="outline">내 끼니 숨김</Badge> : null}
      </span>
    </>
  );

  return (
    <Card className="flex items-center gap-1 p-3">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">{body}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      )}
      <button
        type="button"
        aria-label={`${friend.nickname} 관리`}
        onClick={() => {
          setConfirming(null);
          setOpen(true);
        }}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <MoreVertical className="size-4" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={friend.nickname}>
        <Checkbox
          label="이 친구에게 내 끼니 보이기"
          checked={friend.shareToFriend}
          disabled={busy}
          onChange={(e) =>
            act(
              () => api('PATCH', `/friends/${friend.userId}`, { shareToFriend: e.target.checked }),
              e.target.checked ? '이 친구에게 보여요' : '이 친구에게 숨겼어요',
              false,
            )
          }
        />
        <p className="-mt-2 text-xs text-muted-foreground">
          꺼도 친구는 유지돼요. 공유 설정이 &apos;나만 보기&apos; 면 이 스위치와 상관없이 아무에게도
          보이지 않아요.
        </p>
        <StatusBanner status={status} />
        {confirming ? (
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
            <p className="text-sm">
              {confirming === 'unfriend'
                ? `${friend.nickname}님과 친구를 끊을까요? 서로의 끼니가 바로 보이지 않게 돼요.`
                : `${friend.nickname}님을 차단할까요? 친구가 끊기고, 내 초대 링크로 다시 친구가 될 수 없어요. 같은 친구의 끼니에 남긴 반응·댓글도 서로 보이지 않고 알림도 오지 않아요. 상대에게는 알리지 않아요.`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
                취소
              </Button>
              {confirming === 'unfriend' ? (
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    act(() => api('DELETE', `/friends/${friend.userId}`), '친구를 끊었어요', true)
                  }
                >
                  친구 끊기
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    act(() => api('POST', `/friends/${friend.userId}/block`), '차단했어요', true)
                  }
                >
                  차단
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirming('unfriend')}>
              친구 끊기
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming('block')}>
              차단
            </Button>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
