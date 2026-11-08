import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isValidDateString, todayIn } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { addDays, dateLabel, pad2 } from '@/lib/format';
import { Page, Section } from '@/components/shell/page';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WeightChart } from '@/components/settings/weight-chart';
import { KcalChart } from '@/components/stats/kcal-chart';
import { cn } from '@/lib/utils';

type Summary = Schemas['StatsSummaryDto'];
type Daily = Schemas['StatsDailyDto'];
type Period = 'week' | 'month' | 'custom';

const METRIC_LABELS = [
  ['kcal', '열량', 'kcal'],
  ['proteinG', '단백질', 'g'],
  ['carbG', '탄수화물', 'g'],
  ['fatG', '지방', 'g'],
] as const;

/**
 * 통계 (S-60, FR-06, FR-07, D-20). 계산은 모두 API(/stats/*) 가 한다(NFR-07).
 * 이 화면은 기간을 정하고 값을 보여 주기만 한다. 평균은 '하루 완료 + 지표 완전' 인 날만이고
 * 유효일 0 이면 '데이터 없음'. 미기록을 0 으로 보이지 않는다.
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; at?: string; from?: string; to?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect('/login');
  const today = todayIn(me.timezone);
  const sp = await searchParams;
  const range = resolveRange(sp, today);
  const span = daysBetween(range.from, range.to) + 1;
  const prev = { from: addDays(range.from, -span), to: addDays(range.from, -1) };

  const [cur, before, daily, goals] = await Promise.all([
    apiGet<Summary>(`/stats/summary?from=${range.from}&to=${range.to}`),
    apiGet<Summary>(`/stats/summary?from=${prev.from}&to=${prev.to}`),
    apiGet<Daily>(`/stats/daily?from=${range.from}&to=${range.to}`),
    apiGet<Schemas['GoalDto'][]>('/goals'),
  ]);
  const target = goals.find((g) => g.current)?.targetWeightKg ?? null;
  const weights = daily.days
    .filter((d) => d.weightKg !== null)
    .map((d) => ({ date: d.date, weightKg: d.weightKg! }));
  const incomplete = daily.days.filter((d) => d.completed && !d.complete.kcal);
  const dayHref = (d: string) => (d === today ? '/' : `/day/${d}`);

  return (
    <Page title="통계" wide>
      <PeriodNav range={range} today={today} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="기록 완료율"
          value={pct(cur.completionRate)}
          sub={`완료 ${cur.completedDays}일 / 추적 ${cur.trackedDays}일`}
        />
        <Stat label="연속 기록" value={`${cur.currentStreak}일`} sub="오늘 기준, 하루 완료로 셈" />
        <Stat
          label="목표 달성일"
          value={
            cur.goal.eligibleDays === 0
              ? '데이터 없음'
              : `${cur.goal.achievedDays} / ${cur.goal.eligibleDays}일`
          }
          sub="완료 + 열량 완전인 날 중 목표 이하"
        />
        <Stat
          label="체중 변화"
          value={
            cur.weight.change === null
              ? '데이터 없음'
              : `${cur.weight.change > 0 ? '+' : ''}${cur.weight.change.toFixed(1)} kg`
          }
          sub={
            cur.weight.first && cur.weight.last && cur.weight.measuredDays >= 2
              ? `${cur.weight.first.weightKg} → ${cur.weight.last.weightKg} kg (${cur.weight.measuredDays}회)`
              : `측정 ${cur.weight.measuredDays}회`
          }
        />
      </div>

      <Section title="영양 평균 (완료한 날 기준)">
        <Card>
          <CardContent className="pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">항목</th>
                  <th className="pb-1 text-right font-medium">하루 평균</th>
                  <th className="pb-1 text-right font-medium">유효일</th>
                  <th className="hidden pb-1 text-right font-medium sm:table-cell">제외 이유</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_LABELS.map(([key, label, unit]) => {
                  const m = cur.averages[key];
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="py-1.5">{label}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {m.average === null ? (
                          <span className="text-muted-foreground">데이터 없음</span>
                        ) : (
                          `${unit === 'kcal' ? Math.round(m.average) : m.average.toFixed(1)} ${unit}`
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {m.validDays}/{cur.trackedDays}일
                      </td>
                      <td className="hidden py-1.5 text-right text-xs text-muted-foreground sm:table-cell">
                        {exclusion(cur.notCompletedDays, m.unknownDays)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground sm:hidden">
              제외: {exclusion(cur.notCompletedDays, cur.averages.kcal.unknownDays)} (열량 기준)
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              하루 완료이면서 그 항목의 영양이 모두 확인된 날만 평균에 넣습니다. 안 먹음은 0,
              미기록은 미상이라 0 으로 넣지 않습니다.
            </p>
          </CardContent>
        </Card>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="일별 열량">
          <KcalChart days={daily.days} />
        </Section>
        <Section title="체중 추이">
          <WeightChart items={weights} target={target} />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="계획 식단 실천율">
          <Card>
            <CardContent className="flex flex-col gap-2 pt-3 text-sm">
              <p className="text-lg font-semibold">
                {cur.adherence.rate === null ? (
                  <span className="text-muted-foreground">데이터 없음</span>
                ) : (
                  `${pct(cur.adherence.rate)} (${cur.adherence.asPlannedSlots}/${cur.adherence.plannedSlots}끼)`
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success">계획대로 {cur.adherence.asPlannedSlots}</Badge>
                <Badge variant="outline">다르게 먹음 {cur.adherence.modifiedSlots}</Badge>
                <Badge variant="outline">안 먹음 {cur.adherence.skippedSlots}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                식단 끼니로 기록한 끼니 중 식단 품목·수량 그대로 먹은 비율입니다(정확 일치). 기록
                완료율과는 별개입니다.
                {cur.adherence.excludedByOverride > 0
                  ? ` 날짜 예외로 자유 끼니로 바꾼 ${cur.adherence.excludedByOverride}끼는 분모에서 뺐습니다.`
                  : ''}
                {cur.adherence.overriddenSlots > 0
                  ? ` 날짜 예외로 다른 식단을 적용한 ${cur.adherence.overriddenSlots}끼가 포함됐습니다.`
                  : ''}
              </p>
            </CardContent>
          </Card>
        </Section>

        <Section title={`지난 기간과 비교 (${short(prev.from)} ~ ${short(prev.to)})`}>
          <Card>
            <CardContent className="pt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 font-medium">지표</th>
                    <th className="pb-1 text-right font-medium">지난 기간</th>
                    <th className="pb-1 text-right font-medium">이번 기간</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <Row
                    label="기록 완료율"
                    a={pct(before.completionRate)}
                    b={pct(cur.completionRate)}
                  />
                  <Row
                    label="평균 열량"
                    a={avg(before.averages.kcal.average, 'kcal')}
                    b={avg(cur.averages.kcal.average, 'kcal')}
                  />
                  <Row
                    label="평균 단백질"
                    a={avg(before.averages.proteinG.average, 'g')}
                    b={avg(cur.averages.proteinG.average, 'g')}
                  />
                  <Row
                    label="목표 달성일"
                    a={`${before.goal.achievedDays}/${before.goal.eligibleDays}`}
                    b={`${cur.goal.achievedDays}/${cur.goal.eligibleDays}`}
                  />
                  <Row label="실천율" a={pct(before.adherence.rate)} b={pct(cur.adherence.rate)} />
                  <Row label="체중 변화" a={kg(before.weight.change)} b={kg(cur.weight.change)} />
                </tbody>
              </table>
            </CardContent>
          </Card>
        </Section>
      </div>

      {incomplete.length > 0 ? (
        <Section title="영양 불완전한 날">
          <Card>
            <CardContent className="flex flex-col gap-1 pt-3 text-sm">
              {incomplete.map((d) => (
                <Link
                  key={d.date}
                  href={dayHref(d.date)}
                  className="flex items-center justify-between rounded-md px-1 py-1 hover:bg-accent/50"
                >
                  <span>{dateLabel(d.date)}</span>
                  <span className="text-xs text-muted-foreground">
                    기록된 합계 {Math.round(d.kcal)} kcal · 영양을 보완하면 평균에 들어갑니다
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <details className="rounded-xl border border-border bg-card p-3 text-sm">
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
          날짜별 표
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">날짜</th>
                <th className="pb-1 font-medium">상태</th>
                <th className="pb-1 text-right font-medium">kcal</th>
                <th className="pb-1 text-right font-medium">단백질</th>
                <th className="pb-1 text-right font-medium">목표</th>
                <th className="pb-1 text-right font-medium">체중</th>
              </tr>
            </thead>
            <tbody>
              {daily.days
                .filter((d) => d.tracked)
                .map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="py-1">
                      <Link href={dayHref(d.date)} className="hover:underline">
                        {short(d.date)}
                      </Link>
                    </td>
                    <td className="py-1 text-xs">
                      {!d.completed ? (
                        <span className="text-muted-foreground">미완료</span>
                      ) : d.complete.kcal ? (
                        '완료'
                      ) : (
                        <span className="text-warning-foreground">완료 · 영양 불완전</span>
                      )}
                    </td>
                    <td className="py-1 text-right">{d.completed ? Math.round(d.kcal) : '–'}</td>
                    <td className="py-1 text-right">
                      {d.completed
                        ? `${d.proteinG.toFixed(0)}${d.complete.proteinG ? '' : '+'}`
                        : '–'}
                    </td>
                    <td className="py-1 text-right text-muted-foreground">{d.goalKcal ?? '–'}</td>
                    <td className="py-1 text-right">{d.weightKg ?? '–'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            미완료일은 값을 보이지 않습니다. 단백질 뒤 + 는 미상이 섞인 기록된 합계입니다.
          </p>
        </div>
      </details>
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-lg font-semibold tabular-nums',
            value === '데이터 없음' && 'text-base text-muted-foreground',
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right text-muted-foreground">{a}</td>
      <td className="py-1.5 text-right font-medium">{b}</td>
    </tr>
  );
}

/** 기간 선택: 주(월~일) / 월 / 직접 지정. 오늘 이후로는 넘어가지 않는다 */
function PeriodNav({ range, today }: { range: Range; today: string }) {
  const tab = (p: Period, label: string, href: string) => (
    <Link
      href={href}
      aria-current={range.period === p ? 'page' : undefined}
      className={buttonClasses(
        range.period === p ? 'default' : 'outline',
        'default',
        'h-8 px-3 text-xs',
      )}
    >
      {label}
    </Link>
  );
  const nextAt = range.next && range.next <= today ? range.next : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {tab('week', '주', '/stats?period=week')}
        {tab('month', '월', '/stats?period=month')}
        <form action="/stats" className="flex items-center gap-1">
          <input type="hidden" name="period" value="custom" />
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            max={today}
            aria-label="시작일"
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            aria-label="종료일"
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
          <button type="submit" className={buttonClasses('ghost', 'default', 'h-8 px-2 text-xs')}>
            보기
          </button>
        </form>
      </div>
      <div className="flex items-center gap-1">
        {range.prev ? (
          <Link
            href={`/stats?period=${range.period}&at=${range.prev}`}
            aria-label="이전 기간"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Link>
        ) : null}
        <span className="text-sm font-medium">
          {short(range.from)} ~ {short(range.to)}
        </span>
        {nextAt ? (
          <Link
            href={`/stats?period=${range.period}&at=${nextAt}`}
            aria-label="다음 기간"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

interface Range {
  period: Period;
  from: string;
  to: string;
  prev: string | null;
  next: string | null;
}

/** 표시 기간 계산(화면 상태일 뿐 업무 규칙이 아니다). 사용자 지정은 최대 366일 */
function resolveRange(
  sp: { period?: string; at?: string; from?: string; to?: string },
  today: string,
): Range {
  if (
    sp.period === 'custom' &&
    sp.from &&
    sp.to &&
    isValidDateString(sp.from) &&
    isValidDateString(sp.to) &&
    sp.from <= sp.to &&
    daysBetween(sp.from, sp.to) <= 365
  ) {
    return { period: 'custom', from: sp.from, to: sp.to, prev: null, next: null };
  }
  const at = sp.at && isValidDateString(sp.at) ? sp.at : today;
  if (sp.period === 'month') {
    const [y, m] = at.split('-').map(Number) as [number, number];
    const from = `${y}-${pad2(m)}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${pad2(m)}-${pad2(last)}`;
    return { period: 'month', from, to, prev: addDays(from, -1), next: addDays(to, 1) };
  }
  const w = new Date(`${at}T00:00:00Z`).getUTCDay();
  const from = addDays(at, -((w + 6) % 7)); // 월요일
  const to = addDays(from, 6);
  return { period: 'week', from, to, prev: addDays(from, -7), next: addDays(from, 7) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function short(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
}

function pct(r: number | null): string {
  return r === null ? '데이터 없음' : `${Math.round(r * 100)}%`;
}

function avg(v: number | null, unit: 'kcal' | 'g'): string {
  if (v === null) return '데이터 없음';
  return unit === 'kcal' ? `${Math.round(v)} kcal` : `${v.toFixed(1)} g`;
}

function kg(v: number | null): string {
  return v === null ? '데이터 없음' : `${v > 0 ? '+' : ''}${v.toFixed(1)} kg`;
}

function exclusion(notCompleted: number, unknown: number): string {
  const parts: string[] = [];
  if (notCompleted > 0) parts.push(`미완료 ${notCompleted}일`);
  if (unknown > 0) parts.push(`영양 미상 ${unknown}일`);
  return parts.length === 0 ? '없음' : parts.join(' · ');
}
