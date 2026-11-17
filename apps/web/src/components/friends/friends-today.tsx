import Link from 'next/link';
import { friendDayHref, friendTodayText, type Friend } from '@/lib/friends';
import { cn } from '@/lib/utils';

/** S-10 ⑨ 친구 오늘 줄: 이니셜 + 오늘 요약. 볼 수 없는 친구는 흐리게, 누르면 친구 목록으로 */
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
              <span
                aria-hidden
                className={cn(
                  'flex size-11 items-center justify-center rounded-full border text-sm font-semibold',
                  f.today?.completed
                    ? 'border-transparent bg-accent text-accent-foreground'
                    : 'border-border bg-card',
                )}
              >
                {Array.from(f.nickname)[0] ?? '?'}
              </span>
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
