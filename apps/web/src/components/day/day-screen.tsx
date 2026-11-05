import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SLOT_LABELS } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { addDays, dateLabel } from '@/lib/format';
import { Page, Section } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { NutritionSummary } from './nutrition-summary';
import { SlotCard } from './slot-card';
import { ExtrasPanel } from './extras-panel';
import { WeightQuick } from './weight-quick';

/** 오늘 홈 (S-10 ①~⑥). ⑦ 소진 임박·⑧ 하루 완료는 단계 2 */
export async function DayScreen({ date, today }: { date: string; today: string }) {
  const day = await apiGet<Schemas['DayDto']>(`/days/${date}`);
  const link = (d: string) => (d === today ? '/' : `/day/${d}`);

  return (
    <Page
      title={
        <span className="flex items-center gap-1">
          <Link
            href={link(addDays(date, -1))}
            aria-label="어제"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <span>{day.isToday ? '오늘' : dateLabel(date)}</span>
          <Link
            href={link(addDays(date, 1))}
            aria-label="내일"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-5" />
          </Link>
        </span>
      }
      actions={
        <>
          {!day.isToday ? (
            <Link href="/" className={buttonClasses('ghost', 'default', 'h-8 px-2 text-xs')}>
              오늘로
            </Link>
          ) : null}
          <Link
            href="/plans/calendar"
            className={buttonClasses('outline', 'default', 'h-8 px-2 text-xs')}
          >
            캘린더
          </Link>
        </>
      }
    >
      {day.isToday ? (
        <p className="-mt-2 text-sm text-muted-foreground">{dateLabel(date)}</p>
      ) : null}

      <NutritionSummary nutrition={day.nutrition} />

      <Section title="식사">
        {day.slots.map((s) => (
          <SlotCard key={s.slot} record={s} date={date} highlight={day.nextSlot === s.slot} />
        ))}
        {day.nextSlot ? (
          <p className="text-xs text-muted-foreground">다음 식사: {SLOT_LABELS[day.nextSlot]}</p>
        ) : null}
      </Section>

      <ExtrasPanel date={date} extras={day.extras} />

      <Section title="체중">
        <WeightQuick date={date} weight={day.weight} />
      </Section>

      <p className="text-xs text-muted-foreground">
        하루 완료·소진 임박 제품은 단계 2에서 추가된다. 완료 상태:{' '}
        {day.completion ? '완료' : '진행 중'}
        {day.hasOverride ? ' · 이 날은 날짜 예외가 적용됨' : ''}
      </p>
    </Page>
  );
}
