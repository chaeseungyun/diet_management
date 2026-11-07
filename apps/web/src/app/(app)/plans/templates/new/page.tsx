import { Page } from '@/components/shell/page';
import { TemplateEditor } from '@/components/plans/template-editor';

export default function NewTemplatePage() {
  return (
    <Page title="새 식단" back="/plans">
      <TemplateEditor />
    </Page>
  );
}
