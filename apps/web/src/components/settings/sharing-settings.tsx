'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ShareVisibility } from '@diet/shared';
import { api } from '@/lib/client';
import type { Schemas } from '@/lib/api';
import type { Friend } from '@/lib/friends';
import { Section } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

const LABELS: Record<ShareVisibility, string> = { private: '나만 보기', friends: '친구에게 공개' };

/** S-84 공유 설정: 공개 범위(즉시 저장) + 친구별 스위치 + 몸무게 공개(전체·친구별, DEC-101) + 차단한 사람(해제) */
export function SharingSettings({
  visibility: initial,
  shareWeight: initialShareWeight,
  friends,
  blocked,
}: {
  visibility: ShareVisibility;
  shareWeight: boolean;
  friends: Friend[];
  blocked: Schemas['BlockedUserDto'][];
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  // 차단 해제 결과는 그 칸에 띄운다(맨 위 배너는 스크롤 밖일 수 있다)
  const unblockStatus = useStatus();
  // 몸무게 칸의 결과는 그 칸에 띄운다
  const weightStatus = useStatus();
  const [visibility, setVisibility] = useState(initial);
  const [shareWeight, setShareWeight] = useState(initialShareWeight);
  const [busy, setBusy] = useState(false);

  async function save(work: () => Promise<unknown>, saved: string, runner = run) {
    setBusy(true);
    try {
      await runner(work, saved);
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

  function pickWeight(on: boolean) {
    void save(
      async () => {
        await api('PUT', '/me/sharing', { shareWeight: on });
        setShareWeight(on);
      },
      on ? '고른 친구에게 몸무게를 보여요' : '몸무게를 숨겼어요',
      weightStatus.run,
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
            목표(목표 체중 포함), 남은 양·장보기, 식단 이름과 아직 먹지 않은 끼니의 계획. 몸무게는
            아래에서 따로 켠 친구에게만 보여요.
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

      <Section title="몸무게 공개">
        <Card className="flex flex-col divide-y divide-border">
          <Checkbox
            className="justify-between p-3 flex-row-reverse font-medium"
            label="몸무게도 공개"
            checked={shareWeight}
            disabled={busy}
            onChange={(e) => pickWeight(e.target.checked)}
          />
          {friends.map((f) => (
            <Checkbox
              key={f.userId}
              className="justify-between p-3 flex-row-reverse"
              label={
                <span className="flex flex-col">
                  {f.nickname}
                  {!f.shareToFriend ? (
                    <span className="text-xs text-muted-foreground">
                      끼니를 숨긴 친구라 몸무게도 보이지 않아요
                    </span>
                  ) : null}
                </span>
              }
              checked={f.shareWeightToFriend}
              disabled={busy}
              onChange={(e) =>
                save(
                  () =>
                    api('PATCH', `/friends/${f.userId}`, {
                      shareWeightToFriend: e.target.checked,
                    }),
                  e.target.checked
                    ? `${f.nickname}님에게 몸무게를 보여요`
                    : `${f.nickname}님에게 몸무게를 숨겼어요`,
                  weightStatus.run,
                )
              }
            />
          ))}
        </Card>
        <StatusBanner status={weightStatus.status} />
        <p className="text-xs text-muted-foreground">
          &apos;몸무게도 공개&apos;를 켜고 친구를 고르면, 그 친구가 내 하루를 볼 때 그날 몸무게와
          7일 추이가 보여요. 지난 날의 기록도 보이고, 목표 체중은 보이지 않아요. 새 친구는 꺼진 채로
          시작해요.
          {shareWeight && visibility === 'private'
            ? " 지금은 '나만 보기' 라 몸무게도 아무에게도 보이지 않아요."
            : null}
          {!shareWeight && friends.some((f) => f.shareWeightToFriend)
            ? " 지금은 '몸무게도 공개'가 꺼져 있어 고른 친구에게도 보이지 않아요."
            : null}
        </p>
      </Section>

      <Section title="차단한 사람">
        {blocked.length === 0 ? (
          <EmptyState>차단한 사람이 없어요. 친구 화면의 ⋮ 에서 차단할 수 있어요.</EmptyState>
        ) : (
          <Card className="flex flex-col divide-y divide-border">
            {blocked.map((u) => (
              <div key={u.userId} className="flex items-center justify-between gap-2 p-3">
                <span className="text-sm">{u.nickname}</span>
                <Button
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() =>
                    save(
                      () => api('DELETE', `/friends/${u.userId}/block`),
                      `${u.nickname}님 차단을 풀었어요`,
                      unblockStatus.run,
                    )
                  }
                >
                  차단 해제
                </Button>
              </div>
            ))}
          </Card>
        )}
        <StatusBanner status={unblockStatus.status} />
        <p className="text-xs text-muted-foreground">
          차단을 풀어도 친구로 돌아가지는 않아요. 다시 친구가 되려면 초대 링크를 보내 주세요.
        </p>
      </Section>
    </>
  );
}
