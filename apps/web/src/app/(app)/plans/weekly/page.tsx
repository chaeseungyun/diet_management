import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { WeeklyGrid } from '@/components/plans/weekly-grid';

/** 주간 반복 계획 (S-22) */
export default async function WeeklyPage() {
  const [grid, templates] = await Promise.all([
    apiGet<Schemas['WeeklyGridDto']>('/plans/weekly'),
    apiGet<Schemas['TemplateDto'][]>('/meal-templates'),
  ]);
  return (
    <Page title="주간 반복 계획" back="/plans" wide>
      <WeeklyGrid grid={grid} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
    </Page>
  );
}
