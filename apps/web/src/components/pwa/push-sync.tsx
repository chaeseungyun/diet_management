'use client';

import { useEffect } from 'react';
import { syncPush } from '@/lib/push';

/**
 * 로그인 영역에 한 번 둔다 (DEC-074). 앱을 열 때 이 기기의 구독을 서버에 다시 등록한다.
 * 브라우저가 구독을 바꿨거나, 로그아웃(서버만 해제) 뒤 다시 로그인한 경우를 메운다.
 */
export function PushSync() {
  useEffect(() => {
    syncPush().catch(() => {
      // 실패해도 앱 사용을 막지 않는다. S-71 에서 상태를 다시 본다
    });
  }, []);
  return null;
}
