import { notFound } from 'next/navigation';
import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { TemplateEditor } from '@/components/plans/template-editor';

const UUID = /^[0-9a-f-]{36}$/i;

/** 식단 편집 (S-21) */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const template = await apiGet<Schemas['TemplateDto']>(`/meal-templates/${id}`);
  return (
    <Page title={template.name} back="/plans">
      <TemplateEditor template={template} />
    </Page>
  );
}
