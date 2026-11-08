import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { getMe } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { Card } from '@/components/ui/card';
import { LogoutButton } from '@/components/logout-button';
import { ProfileForm } from '@/components/settings/profile-form';
import { ThemeToggle } from '@/components/settings/theme-toggle';

/** 설정 홈 (S-70). 알림·계정 삭제 화면은 단계 2 */
export default async function SettingsPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  const links: [string, string, string][] = [
    ['/settings/goals', '목표', '체중·열량·단백질 목표와 이력'],
    ['/weight', '체중', '추이·평균·목표까지'],
    ['/settings/install', '앱 설치', '홈 화면에 추가하는 방법·이 기기의 알림 지원 여부'],
  ];
  return (
    <Page title="더보기" actions={<LogoutButton />}>
      <ProfileForm me={me} />
      <Section title="테마">
        <ThemeToggle />
      </Section>
      <Section title="바로가기">
        <ul className="flex flex-col gap-2">
          {links.map(([href, label, desc]) => (
            <li key={href}>
              <Link href={href}>
                <Card className="flex items-center justify-between p-3">
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{desc}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <p className="text-xs text-muted-foreground">
        알림 설정·계정 삭제 화면은 단계 2 에서 추가됩니다. 계정 삭제는 운영 문서의 절차를 따릅니다.
      </p>
    </Page>
  );
}
