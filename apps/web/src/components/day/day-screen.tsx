import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MEAL_SLOTS, SLOT_LABELS, type MealSlot } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { addDays, dateLabel } from '@/lib/format';
import { Page, Section } from '@/components/shell/page';
import { SetupGuide } from '@/components/shell/setup-guide';
import { buttonClasses } from '@/components/ui/button';
import { NutritionSummary } from './nutrition-summary';
import { SlotCard } from './slot-card';
import { ExtrasPanel } from './extras-panel';
import { AddMealMenu } from './add-meal-menu';
import { WeightQuick } from './weight-quick';
import { DayComplete } from './day-complete';
import { InstallBanner } from '@/components/pwa/install-banner';
import { PushBanner } from '@/components/pwa/push-banner';

/** 오늘 홈 (S-10 ①~⑥, ⑧ 하루 완료). ⑦ 소진 임박은 재고 화면과 함께 (D-20 순서) */
export async function DayScreen({
  date,
  today,
  openExtra = false,
}: {
  date: string;
  today: string;
  /** '+ 식사 추가 → 추가 간식' 으로 들어왔을 때 간식 시트를 열어 둔다 */
  openExtra?: boolean;
}) {
  const day = await apiGet<Schemas['DayDto']>(`/days/${date}`);
  const link = (d: string) => (d === today ? '/' : `/day/${d}`);
  const dayHref = link(date);
  // 식단·기록 있는 끼니를 먼저, 미기록 자유 끼니는 뒤에 흐리게 (D-18·D-20)
  const planned = day.slots.filter((s) => s.planType !== 'none' || s.status !== 'unrecorded');
  const free = day.slots.filter((s) => s.planType === 'none' && s.status === 'unrecorded');
  // 카드가 없는 끼니 = 설정에서 숨긴 끼니(기록 없음). '+ 식사 추가' 에서만 들어간다
  const shown = new Set(day.slots.map((s) => s.slot));
  const hidden = MEAL_SLOTS.filter((s) => !shown.has(s)) as MealSlot[];

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

      {day.isToday ? (
        <>
          <InstallBanner />
          <PushBanner />
        </>
      ) : null}

      <SetupGuide />

      <NutritionSummary nutrition={day.nutrition} />

      <Section
        title="식사"
        actions={<AddMealMenu date={date} dayHref={dayHref} hiddenSlots={hidden} />}
      >
        {planned.map((s) => (
          <SlotCard key={s.slot} record={s} date={date} highlight={day.nextSlot === s.slot} />
        ))}
        {planned.length === 0 && free.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            이 날 보이는 끼니가 없습니다. 설정의 &apos;쓰는 끼니&apos; 를 확인하거나 &apos;식사
            추가&apos; 로 기록하세요.
          </p>
        ) : null}
        {day.nextSlot ? (
          <p className="text-xs text-muted-foreground">다음 식사: {SLOT_LABELS[day.nextSlot]}</p>
        ) : null}
        {free.map((s) => (
          <SlotCard key={s.slot} record={s} date={date} highlight={false} />
        ))}
      </Section>

      <ExtrasPanel date={date} dayHref={dayHref} extras={day.extras} initialOpen={openExtra} />

      <Section title="체중">
        <WeightQuick date={date} weight={day.weight} />
      </Section>

      <Section title="하루 완료">
        <DayComplete date={date} check={day.completionCheck} completion={day.completion} />
      </Section>

      {day.hasOverride ? (
        <p className="text-xs text-muted-foreground">이 날은 날짜 예외가 적용됨</p>
      ) : null}
    </Page>
  );
}
