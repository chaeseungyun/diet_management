import { apiGet, type Schemas } from '@/lib/api';
import type { Friend } from '@/lib/friends';
import { Page } from '@/components/shell/page';
import { SharingSettings } from '@/components/settings/sharing-settings';

/** 공유 설정 (S-84): 공개 범위·친구별 스위치·차단한 사람(DEC-097). 친구 코드는 만들지 않는다(DEC-092) */
export default async function SharingSettingsPage() {
  const [sharing, friends, blocked] = await Promise.all([
    apiGet<Schemas['SharingSettingsDto']>('/me/sharing'),
    apiGet<Friend[]>('/friends'),
    apiGet<Schemas['BlockedUserDto'][]>('/friends/blocked'),
  ]);
  return (
    <Page title="공유 설정" back="/settings">
      <SharingSettings
        // 다른 화면에서 바뀐 값으로 돌아왔을 때 서버 값으로 다시 그린다
        key={sharing.visibility}
        visibility={sharing.visibility}
        friends={friends}
        blocked={blocked}
      />
    </Page>
  );
}
