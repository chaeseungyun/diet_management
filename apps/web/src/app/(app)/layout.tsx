import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { BottomTabs, Sidebar } from '@/components/shell/nav';
import { ResumeRefresh } from '@/components/pwa/resume-refresh';
import { PushSync } from '@/components/pwa/push-sync';

/** 로그인 사용자 전용 영역. 비로그인은 S-01 로 (screens.md §1) */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
      <BottomTabs />
      <ResumeRefresh />
      <PushSync />
    </div>
  );
}
