import { redirect } from 'next/navigation';
import { todayIn } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { Card, CardContent } from '@/components/ui/card';
import { WeightChart } from '@/components/settings/weight-chart';
import { WeightList } from '@/components/settings/weight-list';
import { WeightQuick } from '@/components/day/weight-quick';

/** 체중 (S-50): 오늘 입력, 최근 7일 실측 평균(측정 횟수), 목표까지 차이, 주·월 변화, 추이 그래프, 목록 */
export default async function WeightPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  const today = todayIn(me.timezone);
  const data = await apiGet<Schemas['WeightListDto']>('/weights');
  const s = data.summary;
  const todayRecord = data.items.find((w) => w.date === today) ?? null;
  const fmt = (n: number | null, sign = false) =>
    n === null ? '데이터 없음' : `${sign && n > 0 ? '+' : ''}${n.toFixed(1)} kg`;

  return (
    <Page title="체중" back="/settings">
      <WeightQuick date={today} weight={todayRecord} />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Card>
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">최근 7일 평균 ({s.last7Count}회 측정)</p>
            <p className="text-lg font-semibold">{fmt(s.last7Avg)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">
              목표까지{s.targetWeightKg !== null ? ` (목표 ${s.targetWeightKg} kg)` : ''}
            </p>
            <p className="text-lg font-semibold">{fmt(s.diffToTarget, true)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">주간 변화</p>
            <p className="text-lg font-semibold">{fmt(s.weekChange, true)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">월간 변화</p>
            <p className="text-lg font-semibold">{fmt(s.monthChange, true)}</p>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        미측정일은 0으로 채우지 않고 평균에서 제외합니다. 체중과 체지방은 같지 않습니다.
      </p>
      <Section title={`추이 (${data.from} ~ ${data.to})`}>
        <WeightChart items={data.items} target={s.targetWeightKg} />
      </Section>
      <Section title="날짜별 기록">
        <WeightList items={data.items} />
      </Section>
    </Page>
  );
}
