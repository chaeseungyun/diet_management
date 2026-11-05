import { redirect } from 'next/navigation';
import { isValidDateString, todayIn } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { Calendar } from '@/components/plans/calendar';
import { monthGrid, ymd } from '@/lib/format';

/** 캘린더·날짜 예외 (S-23) + 기간 일괄 변경 시트 (S-24) */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect('/login');
  const today = todayIn(me.timezone);
  const sp = await searchParams;
  const selected = sp.date && isValidDateString(sp.date) ? sp.date : today;
  const [y, m] = (sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : selected.slice(0, 7))
    .split('-')
    .map(Number) as [number, number];
  const rows = monthGrid(y, m);
  const from = ymd(y, m, 1);
  const to = rows
    .flat()
    .filter((d): d is string => d !== null)
    .at(-1)!;

  const [days, resolved, templates] = await Promise.all([
    apiGet<Schemas['DaySummaryDto'][]>(`/days?from=${from}&to=${to}`),
    apiGet<Schemas['ResolvedSlotDto'][]>(`/plans/resolved?from=${selected}&to=${selected}`),
    apiGet<Schemas['TemplateDto'][]>('/meal-templates'),
  ]);

  return (
    <Page title="캘린더" back="/plans" wide>
      <Calendar
        year={y}
        month={m}
        rows={rows}
        days={days}
        today={today}
        selected={selected}
        resolved={resolved}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      />
    </Page>
  );
}
