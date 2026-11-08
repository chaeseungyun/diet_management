'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const STALE_MS = 60_000;

/**
 * 홈 화면 앱(standalone)에는 새로고침 버튼·당겨서 새로고침이 없다 (DEC-073).
 * 1분 넘게 백그라운드에 있다가 돌아오면 서버 컴포넌트를 다시 받아 오늘 날짜·기록을 맞춘다.
 * router.refresh 는 클라이언트 상태(입력 중인 값)를 유지한다. 브라우저 탭에서는 하지 않는다.
 */
export function ResumeRefresh() {
  const router = useRouter();
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    if (!standalone) return;
    let hiddenAt = 0;
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > STALE_MS) {
        hiddenAt = 0;
        router.refresh();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [router]);
  return null;
}
