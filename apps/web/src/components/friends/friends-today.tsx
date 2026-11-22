import Link from 'next/link';
import { friendDayHref, friendTodayText, type Friend } from '@/lib/friends';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** S-10 ⑨ 친구 오늘 줄: 프로필 사진(없으면 이니셜, DEC-104) + 오늘 요약. 볼 수 없는 친구는 흐리게, 누르면 친구 목록으로 */
export function FriendsToday({ friends }: { friends: Friend[] }) {
  if (friends.length === 0) return null;
  return (
    <ul aria-label="친구의 오늘" className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
      {friends.map((f) => {
        const href = friendDayHref(f);
        return (
          <li key={f.userId} className="shrink-0">
            <Link
              href={href ?? '/friends'}
              className={cn('flex w-16 flex-col items-center gap-1', !href && 'opacity-50')}
            >
              <Avatar
                userId={f.userId}
                nickname={f.nickname}
                avatarId={f.avatarId}
                className={cn(
                  'size-11',
                  // 하루를 완료한 친구는 테두리로 표시한다
                  f.today?.completed && 'border-2 border-primary',
                  !f.avatarId && f.today?.completed && 'bg-accent text-accent-foreground',
                )}
              />
              <span className="w-full truncate text-center text-xs">{f.nickname}</span>
              <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                {friendTodayText(f)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
