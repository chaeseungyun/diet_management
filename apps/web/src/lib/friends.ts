import type { components } from './api-types';

export type Friend = components['schemas']['FriendDto'];

/** 로그인 전에 연 초대 링크의 코드를 잠깐 두는 sessionStorage 키 (sharing-plan §5, D-14) */
export const PENDING_INVITE_KEY = 'pendingInvite';

/** 친구의 오늘 한 줄: '2/3 끼니 · 완료' / '기록 전' / '비공개' (S-80, S-10 ⑨) */
export function friendTodayText(f: Friend): string {
  if (!f.shared || !f.today) return '비공개';
  const { activeSlots, recordedSlots, completed } = f.today;
  if (completed) return activeSlots > 0 ? `${recordedSlots}/${activeSlots} 끼니 · 완료` : '완료';
  if (recordedSlots === 0) return '기록 전';
  return `${recordedSlots}/${activeSlots} 끼니`;
}

/** 볼 수 있는 친구의 오늘 화면 주소. 볼 수 없으면 null */
export function friendDayHref(f: Friend): string | null {
  return f.shared && f.today ? `/friends/${f.userId}/day/${f.today.date}` : null;
}
