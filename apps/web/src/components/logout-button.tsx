'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearLocalDrafts } from '@/lib/utils';
import { unsubscribeOnLogout } from '@/lib/push';

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      // 이 기기 구독을 서버에서 먼저 해제한다(쿠키가 있어야 한다). 같은 폰으로 다른 사람이
      // 로그인해도 앞사람 알림이 오지 않게. 브라우저 구독은 남겨 다시 로그인하면 PushSync 가 되살린다
      await unsubscribeOnLogout();
      // 같은 오리진 POST 라 브라우저가 Origin 헤더를 붙인다 (CSRF 검사 통과, D-14)
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      clearLocalDrafts();
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="outline" onClick={logout} disabled={busy} className={className}>
      {busy ? '로그아웃 중…' : '로그아웃'}
    </Button>
  );
}
