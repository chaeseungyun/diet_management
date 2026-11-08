'use client';

import { useEffect } from 'react';
import { captureInstallPrompt, markInstalled } from '@/lib/pwa';

/**
 * 루트 레이아웃에 한 번 둔다 (DEC-073).
 * - 서비스 워커 등록(/sw.js, 푸시 전용).
 * - beforeinstallprompt 를 받아 두었다가 S-72·설치 배너의 버튼에서 띄운다.
 */
export function PwaClient() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => {
          // 등록 실패는 앱 사용을 막지 않는다. 알림 설정 화면에서 지원 안 됨으로 보인다
        });
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);
  return null;
}
