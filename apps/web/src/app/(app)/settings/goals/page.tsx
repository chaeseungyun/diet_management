import { redirect } from 'next/navigation';
import { todayIn } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/card';
import { GoalForm } from '@/components/settings/goal-form';

/** 목표 설정 (S-51): 새 목표 저장(이력 추가) + 이전 목표 이력 */
export default async function GoalsPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  const goals = await apiGet<Schemas['GoalDto'][]>('/goals');
  const current = goals.find((g) => g.current) ?? null;

  return (
    <Page title="목표" back="/settings">
      <GoalForm current={current} today={todayIn(me.timezone)} />
      <Section title="이력">
        {goals.length === 0 ? (
          <EmptyState>목표 없음</EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {goals.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {g.effectiveFrom}부터 · {g.targetWeightKg} kg · {g.dailyKcal} kcal · 단{' '}
                  {g.proteinG}g{g.carbG !== null ? ` · 탄 ${g.carbG}g` : ''}
                  {g.fatG !== null ? ` · 지 ${g.fatG}g` : ''}
                </span>
                {g.current ? <Badge variant="success">적용 중</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-muted-foreground">
        과거 실천 평가는 당시 목표로 계산됩니다. 자동 처방·운동 칼로리 가산은 하지 않습니다 (FR-01).
      </p>
    </Page>
  );
}
