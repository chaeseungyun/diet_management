import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { apiGet, type Schemas } from '@/lib/api';
import type { Friend } from '@/lib/friends';
import { Page, Section } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { FriendRow } from '@/components/friends/friend-row';

/** 친구 (S-80, 공유-1a): 내 공개 상태 한 줄 + 친구 목록과 오늘 요약 */
export default async function FriendsPage() {
  const [friends, sharing] = await Promise.all([
    apiGet<Friend[]>('/friends'),
    apiGet<Schemas['SharingSettingsDto']>('/me/sharing'),
  ]);
  return (
    <Page
      title="친구"
      back="/settings"
      actions={
        <Link
          href="/friends/add"
          className={buttonClasses('default', 'default', 'h-8 px-3 text-xs')}
        >
          <UserPlus className="size-4" /> 친구 추가
        </Link>
      }
    >
      <Link href="/settings/sharing">
        <Card className="flex items-center justify-between gap-2 p-3 text-sm">
          <span>
            내 끼니:{' '}
            <span className="font-medium">
              {sharing.visibility === 'friends' ? '친구에게 공개 중' : '나만 보기'}
            </span>
          </span>
          <span className="text-xs text-accent-foreground">공유 설정</span>
        </Card>
      </Link>
      <Section title={`친구 ${friends.length}명`}>
        {friends.length === 0 ? (
          <EmptyState>
            아직 친구가 없어요. &apos;친구 추가&apos; 에서 초대 링크를 만들어 보내 보세요.
          </EmptyState>
        ) : (
          friends.map((f) => <FriendRow key={f.userId} friend={f} />)
        )}
      </Section>
      <p className="text-xs text-muted-foreground">
        &apos;비공개&apos; 는 친구가 끼니를 공개하지 않았다는 뜻이에요.
      </p>
    </Page>
  );
}
