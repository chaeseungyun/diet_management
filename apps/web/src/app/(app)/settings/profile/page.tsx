import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { ProfileEdit } from '@/components/settings/profile-edit';

/** 프로필 편집 (S-74, DEC-104): 사진·닉네임·상태 메시지 */
export default async function ProfilePage() {
  const me = await getMe();
  if (!me) redirect('/login');
  return (
    <Page title="프로필" back="/settings">
      <ProfileEdit me={me} />
    </Page>
  );
}
