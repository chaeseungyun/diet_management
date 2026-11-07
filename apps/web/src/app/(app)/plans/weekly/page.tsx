import { redirect } from 'next/navigation';
import type { MealSlot } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { SetupGuide } from '@/components/shell/setup-guide';
import { WeeklyGrid } from '@/components/plans/weekly-grid';

/** 식단표 — 요일×끼니 반복 계획 (S-22) */
export default async function WeeklyPage() {
  const [me, grid, templates] = await Promise.all([
    getMe(),
    apiGet<Schemas['WeeklyGridDto']>('/plans/weekly'),
    apiGet<Schemas['TemplateDto'][]>('/meal-templates'),
  ]);
  if (!me) redirect('/login');
  return (
    <Page title="식단표" back="/plans" wide>
      {templates.length === 0 ? <SetupGuide title="먼저 식단이 필요합니다" /> : null}
      <WeeklyGrid
        grid={grid}
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        slots={me.activeSlots as MealSlot[]}
      />
    </Page>
  );
}
