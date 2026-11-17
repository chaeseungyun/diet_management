import Link from 'next/link';
import { Page } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/card';

/** 친구의 하루를 볼 수 없을 때. 이유(친구 아님·비공개·없는 날)는 구분하지 않는다 (D-06) */
export default function FriendNotFound() {
  return (
    <Page title="볼 수 없어요" back="/friends">
      <EmptyState>
        이 화면은 지금 볼 수 없어요. 친구가 끼니를 공개하지 않았거나 볼 수 없는 날짜예요.
      </EmptyState>
      <Link href="/friends" className={buttonClasses('outline')}>
        친구 목록으로
      </Link>
    </Page>
  );
}
