import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Circle, Minus } from 'lucide-react';
import { SLOT_LABELS, formatQuantity, isValidDateString } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { addDays, dateLabel } from '@/lib/format';
import { Page, Section } from '@/components/shell/page';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardContent, EmptyState } from '@/components/ui/card';
import { SharedPhotos } from '@/components/friends/shared-photos';
import { MealSocial } from '@/components/friends/meal-social';
import { WeightChart } from '@/components/settings/weight-chart';
import { cn } from '@/lib/utils';

type Meal = Schemas['SharedMealDto'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** 친구의 하루 (S-83): S-10 의 읽기 전용 축소판. 기록 버튼이 없고 서버가 고른 필드만 그린다. 쓰는 것은 반응·댓글뿐 (DEC-092) */
export default async function FriendDayPage({
  params,
}: {
  params: Promise<{ userId: string; date: string }>;
}) {
  const { userId, date } = await params;
  if (!UUID_RE.test(userId) || !isValidDateString(date)) notFound();
  const day = await apiGet<Schemas['SharedDayDto']>(`/friends/${userId}/days/${date}`);
  const href = (d: string) => `/friends/${userId}/day/${d}`;
  const isToday = date === day.today;
  const n = day.nutrition;

  return (
    <Page
      title={`${day.owner.nickname}님의 하루`}
      back="/friends"
      actions={
        !isToday ? (
          <Link
            href={href(day.today)}
            className={buttonClasses('ghost', 'default', 'h-8 px-2 text-xs')}
          >
            오늘로
          </Link>
        ) : null
      }
    >
      <div className="-mt-2 flex items-center justify-between">
        <DayLink href={href(addDays(date, -1))} label="전날" disabled={date <= day.firstDate}>
          <ChevronLeft className="size-5" />
        </DayLink>
        <span className="flex items-center gap-2 text-sm font-medium">
          {isToday ? `오늘 · ${dateLabel(date)}` : dateLabel(date)}
          {day.completed ? (
            <Badge variant="success">
              <Check className="size-3" /> 하루 완료
            </Badge>
          ) : null}
        </span>
        <DayLink href={href(addDays(date, 1))} label="다음 날" disabled={date >= day.today}>
          <ChevronRight className="size-5" />
        </DayLink>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div>
            <p className="text-xs text-muted-foreground">
              {n.complete ? '기록된 열량' : '기록된 합계 (영양 일부 미확인)'}
            </p>
            <p className="text-2xl font-semibold">
              {Math.round(n.kcal)}{' '}
              <span className="text-sm font-normal text-muted-foreground">kcal</span>
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            {(
              [
                ['단백질', n.proteinG],
                ['탄수화물', n.carbG],
                ['지방', n.fatG],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{formatQuantity(v, 1)}g</dd>
              </div>
            ))}
          </dl>
          {n.missing > 0 ? (
            <div>
              <Badge variant="warning">영양 미확인 {n.missing}건</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {day.weight ? <WeightCard weight={day.weight} /> : null}

      <Section title="식사">
        {day.slots.length === 0 ? (
          <EmptyState>이 날 보이는 끼니가 없어요.</EmptyState>
        ) : (
          day.slots.map((m) => <MealCard key={m.slot} meal={m} ownerId={userId} />)
        )}
      </Section>

      {day.extras.length > 0 ? (
        <Section title="추가 간식">
          {day.extras.map((m, i) => (
            <MealCard key={m.recordId ?? i} meal={m} ownerId={userId} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

/** 친구가 나에게 몸무게를 켰을 때만 온다 (DEC-101): 그날 값 + 그날까지 7일. 목표·변화량은 없다 */
function WeightCard({ weight }: { weight: NonNullable<Schemas['SharedDayDto']['weight']> }) {
  const measured = weight.recent.flatMap((p) =>
    p.weightKg === null ? [] : [{ date: p.date, weightKg: p.weightKg }],
  );
  return (
    <Section title="몸무게">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          {weight.weightKg === null ? (
            <p className="text-sm text-muted-foreground">이 날은 기록이 없어요.</p>
          ) : (
            <p className="text-2xl font-semibold">
              {formatQuantity(weight.weightKg, 1)}{' '}
              <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
          )}
          {measured.length > 0 ? (
            <WeightChart
              items={measured}
              target={null}
              range={{ from: weight.recent[0]!.date, to: weight.recent.at(-1)!.date }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">최근 7일 동안 기록이 없어요.</p>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

function DayLink({
  href,
  label,
  disabled,
  children,
}: {
  href: string;
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls = 'rounded-md p-1 text-muted-foreground';
  // 가입 전·미래는 서버가 404 를 주므로 링크를 만들지 않는다
  return disabled ? (
    <span aria-hidden className={cn(cls, 'opacity-30')}>
      {children}
    </span>
  ) : (
    <Link href={href} aria-label={label} className={cn(cls, 'hover:text-foreground')}>
      {children}
    </Link>
  );
}

function MealCard({ meal, ownerId }: { meal: Meal; ownerId: string }) {
  const eaten = meal.status === 'eaten';
  const summary = !eaten
    ? null
    : meal.kind === 'outside'
      ? `식단 외 · ${meal.outsideMenu ?? ''}`
      : meal.items.length > 0
        ? meal.items
            .map((i) =>
              i.quantity === null
                ? i.name
                : `${i.name} ${formatQuantity(i.quantity)}${i.displayUnit}`,
            )
            .join(', ')
        : '품목 없음';
  return (
    <Card className={cn('flex flex-col gap-2 p-3', meal.status === 'unrecorded' && 'bg-card/60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{SLOT_LABELS[meal.slot]}</p>
          {summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
        </div>
        {eaten ? (
          <Badge variant="success">
            <Check className="size-3" /> 먹었음
          </Badge>
        ) : meal.status === 'skipped' ? (
          <Badge variant="secondary">
            <Minus className="size-3" /> 안 먹음
          </Badge>
        ) : (
          <Badge variant="outline">
            <Circle className="size-3" /> 기록 전
          </Badge>
        )}
      </div>
      <SharedPhotos ownerId={ownerId} photos={meal.photos} />
      {meal.social ? <MealSocial ownerId={ownerId} social={meal.social} canReact /> : null}
    </Card>
  );
}
