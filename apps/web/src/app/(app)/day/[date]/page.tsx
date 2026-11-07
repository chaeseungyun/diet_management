import { notFound, redirect } from 'next/navigation';
import { isValidDateString, todayIn } from '@diet/shared';
import { getMe } from '@/lib/api';
import { DayScreen } from '@/components/day/day-screen';

/** 특정 날짜의 S-10 (어제·캘린더에서 진입) */
export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ extra?: string }>;
}) {
  const [{ date }, sp] = await Promise.all([params, searchParams]);
  if (!isValidDateString(date)) notFound();
  const me = await getMe();
  if (!me) redirect('/login');
  return <DayScreen date={date} today={todayIn(me.timezone)} openExtra={sp.extra === '1'} />;
}
