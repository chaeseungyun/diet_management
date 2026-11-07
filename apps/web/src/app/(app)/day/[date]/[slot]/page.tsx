import { notFound, redirect } from 'next/navigation';
import { MEAL_SLOTS, SLOT_LABELS, isValidDateString, todayIn, type MealSlot } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { MealRecordEditor } from '@/components/day/meal-record-editor';
import { dateLabel } from '@/lib/format';

/** 식사 슬롯 상세·기록 (S-11, S-12) */
export default async function SlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string; slot: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const [{ date, slot }, sp] = await Promise.all([params, searchParams]);
  if (!isValidDateString(date) || !(MEAL_SLOTS as readonly string[]).includes(slot)) notFound();
  const me = await getMe();
  if (!me) redirect('/login');
  const [record, templates] = await Promise.all([
    apiGet<Schemas['MealRecordDto']>(`/meal-records/${date}/${slot}`),
    apiGet<Schemas['TemplateDto'][]>('/meal-templates'),
  ]);
  const today = todayIn(me.timezone);
  return (
    <Page
      title={`${dateLabel(date)} ${SLOT_LABELS[slot as MealSlot]}`}
      back={date === today ? '/' : `/day/${date}`}
    >
      <MealRecordEditor
        initial={record}
        date={date}
        slot={slot as MealSlot}
        today={today}
        templates={templates}
        autoStart={sp.action === 'eat'}
      />
    </Page>
  );
}
