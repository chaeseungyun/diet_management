import { redirect } from 'next/navigation';
import { todayIn } from '@diet/shared';
import { getMe } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { Onboarding } from '@/components/settings/onboarding';

/** 첫 설정 (S-03, 제안). 시간대 확인 + 목표 입력, 건너뛰기 가능 */
export default async function OnboardingPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.onboardedAt) redirect('/');
  return (
    <Page title="첫 설정">
      <Onboarding me={me} today={todayIn(me.timezone)} />
    </Page>
  );
}
