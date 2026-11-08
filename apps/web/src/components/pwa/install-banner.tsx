'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Smartphone, X } from 'lucide-react';
import { usePwaEnv } from '@/lib/pwa';

const KEY = 'pwa-install-banner-dismissed';

/**
 * 오늘 화면의 설치 안내 한 줄 (DEC-073). 휴대폰 브라우저에서만 보이고, 닫으면 이 기기에서 다시
 * 보이지 않는다(localStorage — 기기별 편의 설정이라 서버에 저장하지 않음).
 */
export function InstallBanner() {
  const env = usePwaEnv();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!env || dismissed) return null;
  if (env.standalone || env.installedNow || env.os === 'other') return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-accent px-3 py-2 text-sm text-accent-foreground">
      <Smartphone className="size-4 shrink-0" aria-hidden />
      <Link href="/settings/install" className="min-w-0 flex-1 underline-offset-2 hover:underline">
        홈 화면에 추가하면 앱처럼 열고 식사 알림도 받을 수 있어요
      </Link>
      <button
        type="button"
        aria-label="설치 안내 닫기"
        className="rounded-md p-1 hover:bg-background/40"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            // 저장이 막혀 있으면 이번 방문 동안만 닫는다
          }
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
