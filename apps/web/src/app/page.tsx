import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { LogoutButton } from '@/components/logout-button';

/**
 * 오늘 홈 (S-10). 단계 0 에서는 로그인 확인과 프로필 표시만 한다.
 * 비로그인은 S-01 로 보낸다(screens.md §1).
 */
export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">오늘</h1>
        <LogoutButton />
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">로그인됨</p>
        <p className="mt-1 text-lg font-medium">{me.nickname}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">시간대</dt>
          <dd>{me.timezone}</dd>
          <dt className="text-muted-foreground">첫 설정</dt>
          <dd>{me.onboardedAt ? '완료' : '미완료'}</dd>
        </dl>
      </section>

      <p className="text-sm text-muted-foreground">
        식사 기록·식단·재고 화면은 단계 1부터 추가된다.
      </p>
    </main>
  );
}
