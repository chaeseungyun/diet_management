import { Page } from '@/components/shell/page';
import { TemplateEditor } from '@/components/plans/template-editor';

export default function NewTemplatePage() {
  return (
    <Page title="새 템플릿" back="/plans">
      <TemplateEditor />
    </Page>
  );
}
