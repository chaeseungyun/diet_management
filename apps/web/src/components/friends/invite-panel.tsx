'use client';

import { useEffect, useState } from 'react';
import { Copy, Link2, Share2, Trash2 } from 'lucide-react';
import { FRIEND_INVITE_MAX_ACTIVE, FRIEND_INVITE_TTL_DAYS } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Invite = Schemas['FriendInviteDto'];

function expiryLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일까지`;
}

/** S-81 ① 초대 링크: 만들기·복사·보내기(OS 공유 시트)·지우기. 링크는 1회용이다 */
export function InvitePanel({ initial }: { initial: Invite[] }) {
  const { status, run, set } = useStatus();
  const [invites, setInvites] = useState(initial);
  const [busy, setBusy] = useState(false);
  // 공유 시트 지원 여부는 브라우저에서만 안다(서버 렌더와 어긋나지 않게 마운트 뒤에 켠다)
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);

  async function create() {
    setBusy(true);
    try {
      const made = await run(
        () => api<Invite>('POST', '/friend-invites'),
        '초대 링크를 만들었어요',
      );
      setInvites((cur) => [...cur, made]);
    } catch {
      // 배너가 표시한다
    } finally {
      setBusy(false);
    }
  }

  async function copy(inv: Invite) {
    try {
      await navigator.clipboard.writeText(inv.url);
      set({ kind: 'saved', message: '링크를 복사했어요' });
    } catch {
      set({ kind: 'error', message: '복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.' });
    }
  }

  async function share(inv: Invite) {
    try {
      await navigator.share({ title: '끼니로그 친구 초대', url: inv.url });
    } catch {
      // 사용자가 공유 시트를 닫았다
    }
  }

  async function revoke(inv: Invite) {
    setBusy(true);
    try {
      await run(() => api('DELETE', `/friend-invites/${inv.id}`), '링크를 지웠어요');
      setInvites((cur) => cur.filter((x) => x.id !== inv.id));
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        링크를 받은 사람이 열어서 수락하면 바로 친구가 돼요. 링크 하나는 한 사람만 쓸 수 있고{' '}
        {FRIEND_INVITE_TTL_DAYS}일 뒤 만료돼요.
      </p>
      <Button onClick={create} disabled={busy || invites.length >= FRIEND_INVITE_MAX_ACTIVE}>
        <Link2 className="size-4" /> 초대 링크 만들기
      </Button>
      <StatusBanner status={status} />
      {invites.length === 0 ? (
        <EmptyState>아직 만든 링크가 없어요.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((inv) => (
            <li key={inv.id}>
              <Card className="flex flex-col gap-2 p-3">
                <p className="break-all text-sm select-all">{inv.url}</p>
                <p className="text-xs text-muted-foreground">{expiryLabel(inv.expiresAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {canShare ? (
                    <Button className="h-9 flex-1 px-3" onClick={() => share(inv)}>
                      <Share2 className="size-4" /> 보내기
                    </Button>
                  ) : null}
                  <Button variant="outline" className="h-9 flex-1 px-3" onClick={() => copy(inv)}>
                    <Copy className="size-4" /> 복사
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-9 px-3"
                    aria-label="링크 지우기"
                    disabled={busy}
                    onClick={() => revoke(inv)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        쓸 수 있는 링크는 {FRIEND_INVITE_MAX_ACTIVE}개까지예요. 잘못 보낸 링크는 지우면 더 이상 쓸
        수 없어요.
      </p>
    </div>
  );
}
