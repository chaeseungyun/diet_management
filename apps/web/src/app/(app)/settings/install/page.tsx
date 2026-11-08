import { Page } from '@/components/shell/page';
import { InstallGuide } from '@/components/pwa/install-guide';

/** S-72 PWA 설치 안내 (DEC-073). 브라우저·OS별 방법과 이 기기의 설치·알림 지원 여부 */
export default function InstallPage() {
  return (
    <Page title="앱 설치" back="/settings">
      <InstallGuide />
    </Page>
  );
}
