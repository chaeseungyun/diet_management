'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * 페이지·레이아웃의 서버 오류를 루트 레이아웃 안에서 받는다.
 * 전역 에러 경계까지 올라가면 루트 레이아웃이 클라이언트에서 다시 그려져
 * 테마 인라인 스크립트 경고가 나므로, 여기서 멈춘다.
 * 개발 중 흔한 원인: pnpm dev 직후 API(:4000)가 아직 뜨지 않음(ECONNREFUSED).
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1>
      <p className="text-sm text-muted-foreground">
        서버에 연결하지 못했거나 처리 중 오류가 났습니다. API가 아직 켜지는 중이라면 잠시 뒤 다시
        시도해 주세요.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">오류 코드 {error.digest}</p>
      ) : null}
      <Button onClick={retry}>다시 시도</Button>
    </main>
  );
}
