import { redirect } from 'next/navigation';
import { todayIn } from '@diet/shared';
import { getMe } from '@/lib/api';
import { DayScreen } from '@/components/day/day-screen';

/** 오늘 홈 (S-10). 첫 로그인은 S-03 으로 한 번 보낸다 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ extra?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me) redirect('/login');
  if (!me.onboardedAt) redirect('/onboarding');
  const today = todayIn(me.timezone);
  return <DayScreen date={today} today={today} openExtra={sp.extra === '1'} />;
}
