'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ShareVisibility } from '@diet/shared';
import { api } from '@/lib/client';
import type { Friend } from '@/lib/friends';
import { Section } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

const LABELS: Record<ShareVisibility, string> = { private: '나만 보기', friends: '친구에게 공개' };

/** S-84 공유 설정: 공개 범위(즉시 저장) + 친구별 스위치 */
export function SharingSettings({
  visibility: initial,
  friends,
}: {
  visibility: ShareVisibility;
  friends: Friend[];
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [visibility, setVisibility] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(work: () => Promise<unknown>, saved: string) {
    setBusy(true);
    try {
      await run(work, saved);
      router.refresh();
    } catch {
      // 배너가 표시한다
    } finally {
      setBusy(false);
    }
  }

  function pick(v: ShareVisibility) {
    if (v === visibility) return;
    void save(
      async () => {
        await api('PUT', '/me/sharing', { visibility: v });
        setVisibility(v);
      },
      v === 'friends' ? '친구에게 공개해요' : '나만 볼 수 있어요',
    );
  }

  return (
    <>
      <Section title="내 끼니 공개 범위">
        <div className="grid grid-cols-2 gap-2">
          {(['private', 'friends'] as const).map((v) => (
            <Button
              key={v}
              variant={visibility === v ? 'default' : 'outline'}
              aria-pressed={visibility === v}
              disabled={busy}
              onClick={() => pick(v)}
            >
              {LABELS[v]}
            </Button>
          ))}
        </div>
        <StatusBanner status={status} />
        <Card className="flex flex-col gap-1 p-3 text-sm">
          <p className="font-medium">친구에게 공개하면 보이는 것</p>
          <p className="text-muted-foreground">
            끼니별 상태, 먹은 식품과 양, 식단 외 메뉴명, 식사 사진, 하루 영양 합계, 하루 완료 여부.
            가입한 날부터 오늘까지 모든 날이 보여요.
          </p>
          <p className="mt-1 font-medium">보이지 않는 것</p>
          <p className="text-muted-foreground">
            체중, 목표, 남은 양·장보기, 식단 이름과 아직 먹지 않은 끼니의 계획.
          </p>
        </Card>
      </Section>

      <Section title="친구별로 보이기">
        {friends.length === 0 ? (
          <EmptyState>아직 친구가 없어요.</EmptyState>
        ) : (
          <Card className="flex flex-col divide-y divide-border">
            {friends.map((f) => (
              <Checkbox
                key={f.userId}
                className="justify-between p-3 flex-row-reverse"
                label={f.nickname}
                checked={f.shareToFriend}
                disabled={busy}
                onChange={(e) =>
                  save(
                    () => api('PATCH', `/friends/${f.userId}`, { shareToFriend: e.target.checked }),
                    e.target.checked
                      ? `${f.nickname}님에게 보여요`
                      : `${f.nickname}님에게 숨겼어요`,
                  )
                }
              />
            ))}
          </Card>
        )}
        {visibility === 'private' && friends.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            지금은 &apos;나만 보기&apos; 라 위 스위치와 상관없이 아무에게도 보이지 않아요.
          </p>
        ) : null}
      </Section>
    </>
  );
}
