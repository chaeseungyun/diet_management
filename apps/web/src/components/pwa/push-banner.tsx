'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import { usePwaEnv } from '@/lib/pwa';
import { currentSubscription, fetchPublicKey, turnOnNotifications } from '@/lib/push';

const KEY = 'push-banner-dismissed';

type State =
  | { kind: 'hidden' }
  | { kind: 'offer'; busy: boolean; error?: string }
  | { kind: 'done'; message: string };

/**
 * 오늘 화면의 '끼니 알림 받기' 한 줄 (DEC-077). 버튼 한 번으로 권한 요청·구독·쓰는 끼니 알림 켜기.
 * 알림을 받을 수 있는데 이 기기가 아직 꺼져 있을 때만 보인다. 설치 배너가 보이는 환경(휴대폰
 * 브라우저 탭)에서는 설치를 먼저 권하므로 숨긴다. 닫으면 이 기기에서 다시 보이지 않는다.
 */
export function PushBanner() {
  const env = usePwaEnv();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'hidden' });

  const eligible =
    !!env &&
    env.pushSupported &&
    !env.inApp &&
    (env.standalone || env.installedNow || env.os === 'other') &&
    env.notificationPermission !== 'denied';

  useEffect(() => {
    if (!eligible) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === '1';
    } catch {
      // 저장소가 막혀 있으면 보인다
    }
    if (dismissed) return;
    let alive = true;
    Promise.all([fetchPublicKey(), currentSubscription()])
      .then(([publicKey, sub]) => {
        const on = Notification.permission === 'granted' && sub !== null;
        if (alive && publicKey && !on) setState({ kind: 'offer', busy: false });
      })
      .catch(() => {
        // 상태를 모르면 띄우지 않는다
      });
    return () => {
      alive = false;
    };
  }, [eligible]);

  if (state.kind === 'hidden') return null;

  function dismiss() {
    setState({ kind: 'hidden' });
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // 이번 방문 동안만 닫는다
    }
  }

  async function turnOn() {
    setState({ kind: 'offer', busy: true });
    try {
      const out = await turnOnNotifications();
      if (out.result === 'subscribed') {
        setState({
          kind: 'done',
          message:
            out.enabledCount > 0
              ? `끼니 알림 ${out.enabledCount}개를 켰어요. 시각 바꾸기`
              : '이 기기에서 알림을 받아요. 알림 설정 보기',
        });
        router.refresh();
      } else if (out.result === 'denied') {
        // 차단하면 앱에서 다시 물을 수 없다. 방법은 S-71 이 안내한다
        setState({ kind: 'done', message: '알림이 차단됐어요. 허용하는 방법 보기' });
      } else {
        setState({ kind: 'offer', busy: false });
      }
    } catch {
      setState({ kind: 'offer', busy: false, error: '알림을 켜지 못했어요. 다시 시도해 주세요' });
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-accent px-3 py-2 text-sm text-accent-foreground">
      <Bell className="size-4 shrink-0" aria-hidden />
      {state.kind === 'done' ? (
        <Link
          href="/settings/notifications"
          className="min-w-0 flex-1 underline underline-offset-2"
        >
          {state.message}
        </Link>
      ) : (
        <>
          <span className="min-w-0 flex-1" role={state.error ? 'alert' : undefined}>
            {state.error ?? '기록할 시간에 알림을 받아 보세요'}
          </span>
          <button
            type="button"
            onClick={() => void turnOn()}
            disabled={state.busy}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {state.busy ? '켜는 중…' : '알림 켜기'}
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="알림 안내 닫기"
        className="rounded-md p-1 hover:bg-background/40"
        onClick={dismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
