'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearLocalDrafts } from '@/lib/utils';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      // 같은 오리진 POST 라 브라우저가 Origin 헤더를 붙인다 (CSRF 검사 통과, D-14)
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      clearLocalDrafts();
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="outline" onClick={logout} disabled={busy}>
      {busy ? '로그아웃 중…' : '로그아웃'}
    </Button>
  );
}
