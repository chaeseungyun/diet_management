import { apiGet, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { InvitePanel } from '@/components/friends/invite-panel';

/** 친구 추가 (S-81, 공유-1a 는 초대 링크만. 친구 코드·QR 은 공유-1b) */
export default async function FriendAddPage() {
  const invites = await apiGet<Schemas['FriendInviteDto'][]>('/friend-invites');
  return (
    <Page title="친구 추가" back="/friends">
      <Section title="초대 링크">
        <InvitePanel initial={invites} />
      </Section>
    </Page>
  );
}
