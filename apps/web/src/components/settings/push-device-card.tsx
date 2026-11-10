'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing, CircleAlert } from 'lucide-react';
import { usePwaEnv, type PwaEnv } from '@/lib/pwa';
import { currentSubscription, disablePush, enablePush, fetchPublicKey, testPush } from '@/lib/push';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBanner, useStatus } from '@/components/ui/status';

interface DeviceState {
  serverReady: boolean;
  permission: NotificationPermission;
  endpoint: string | null;
}

/**
 * S-71 맨 위: 이 기기에서 알림을 받는지. 권한·구독은 기기(브라우저)마다 따로다.
 * 지원 안 됨 / 아이폰 Safari 탭 / 서버 준비 전 / 거부됨 / 꺼짐 / 받는 중 순으로 판정한다.
 */
export function PushDeviceCard() {
  const env = usePwaEnv();
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { status, set, run } = useStatus();

  const refresh = useCallback(async () => {
    try {
      const [publicKey, sub] = await Promise.all([fetchPublicKey(), currentSubscription()]);
      setDevice({
        serverReady: publicKey !== null,
        permission: Notification.permission,
        endpoint: Notification.permission === 'granted' && sub ? sub.endpoint : null,
      });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (env?.pushSupported && !env.inApp) void refresh();
  }, [env?.pushSupported, env?.inApp, refresh]);

  if (!env) return <Card className="h-24 animate-pulse p-4" aria-hidden />;

  const blocked = unsupportedMessage(env);
  if (blocked) {
    return (
      <Shell icon="off" title="이 기기에서는 알림을 받을 수 없어요">
        <p>{blocked}</p>
        <Link href="/settings/install" className="text-primary underline underline-offset-2">
          앱 설치 안내 보기
        </Link>
      </Shell>
    );
  }
  if (loadError) {
    return (
      <Shell icon="alert" title="알림 상태를 불러오지 못했어요">
        <Button variant="outline" onClick={() => void refresh()}>
          다시 시도
        </Button>
      </Shell>
    );
  }
  if (!device) return <Card className="h-24 animate-pulse p-4" aria-hidden />;
  if (!device.serverReady) {
    return (
      <Shell icon="off" title="알림 준비 중">
        <p>서버에 알림 키가 아직 설정되지 않았습니다. 설정은 미리 저장해 둘 수 있습니다.</p>
      </Shell>
    );
  }
  if (device.permission === 'denied') {
    return (
      <Shell icon="alert" title="알림이 차단되어 있어요">
        <p>앱에서 다시 물어볼 수 없어 기기 설정에서 직접 허용해야 합니다.</p>
        <p className="text-muted-foreground">{deniedHelp(env)}</p>
        <Button variant="outline" onClick={() => void refresh()}>
          허용했어요, 다시 확인
        </Button>
      </Shell>
    );
  }

  async function turnOn() {
    try {
      const r = await run(() => enablePush());
      if (r === 'subscribed') set({ kind: 'saved', message: '이 기기에서 알림을 받습니다' });
      else if (r === 'dismissed')
        set({ kind: 'error', message: '권한 요청을 닫았습니다. 다시 눌러 허용해 주세요.' });
      else if (r === 'unavailable') set({ kind: 'error', message: '알림을 켤 수 없습니다.' });
      else set({ kind: 'idle' });
    } catch {
      // 배너
    }
    await refresh();
  }

  async function turnOff() {
    try {
      await run(() => disablePush(), '이 기기 알림을 껐습니다');
    } catch {
      // 배너
    }
    await refresh();
  }

  async function sendTest(endpoint: string) {
    try {
      const r = await run(() => testPush(endpoint));
      if (r.ok) set({ kind: 'saved', message: '테스트 알림을 보냈습니다. 몇 초 안에 도착합니다' });
      else
        set({
          kind: 'error',
          message: `보내지 못했습니다${r.status ? ` (${r.status})` : ''}${r.reason ? `: ${r.reason}` : ''}`,
        });
    } catch {
      // 배너 (404 = 이 기기 구독이 서버에 없음 → 껐다 다시 켜기)
    }
    await refresh();
  }

  if (device.endpoint) {
    const endpoint = device.endpoint;
    return (
      <Shell icon="on" title="이 기기에서 알림 받는 중">
        <StatusBanner status={status} />
        <p className="text-muted-foreground">
          아래에서 켠 끼니만 보냅니다. 알림을 켠 다른 기기에도 같이 갑니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void sendTest(endpoint)} disabled={status.kind === 'saving'}>
            테스트 알림 보내기
          </Button>
          <Button
            variant="outline"
            onClick={() => void turnOff()}
            disabled={status.kind === 'saving'}
          >
            이 기기 알림 끄기
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell icon="off" title="이 기기는 알림이 꺼져 있어요">
      <StatusBanner status={status} />
      <p className="text-muted-foreground">
        켜면 브라우저가 알림 권한을 묻습니다. 허용해야 끼니 알림을 받을 수 있습니다.
      </p>
      <Button onClick={() => void turnOn()} disabled={status.kind === 'saving'}>
        알림 켜기
      </Button>
    </Shell>
  );
}

function Shell({
  icon,
  title,
  children,
}: {
  icon: 'on' | 'off' | 'alert';
  title: string;
  children: React.ReactNode;
}) {
  const Icon = icon === 'on' ? BellRing : icon === 'off' ? BellOff : CircleAlert;
  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <p className="flex items-center gap-2 text-base font-semibold">
        <Icon
          className={icon === 'on' ? 'size-5 text-primary' : 'size-5 text-muted-foreground'}
          aria-hidden
        />
        {title}
      </p>
      {children}
    </Card>
  );
}

function unsupportedMessage(env: PwaEnv): string | null {
  if (env.inApp)
    return '카카오톡 같은 앱 안 브라우저에서는 알림을 받을 수 없습니다. 크롬·Safari 로 열어 주세요.';
  if (env.pushSupported) return null;
  if (env.os === 'ios' && !env.standalone)
    return '아이폰은 Safari 에서 홈 화면에 추가한 앱으로 열어야 알림을 받을 수 있습니다(iOS 16.4 이상).';
  return '이 브라우저는 웹 알림을 지원하지 않습니다.';
}

function deniedHelp(env: PwaEnv): string {
  if (env.os === 'ios') return '설정 앱 → 알림 → 식단 관리 → 알림 허용';
  if (env.os === 'android' && env.standalone)
    return '앱 아이콘 길게 누르기 → 앱 정보 → 알림 → 허용';
  if (env.os === 'android') return '주소창 왼쪽 아이콘 → 권한(사이트 설정) → 알림 → 허용';
  return '주소창 왼쪽 아이콘 → 사이트 설정 → 알림 → 허용';
}
