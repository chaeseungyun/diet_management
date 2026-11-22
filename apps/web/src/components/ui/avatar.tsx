'use client';

import { useState } from 'react';
import { API_PREFIX } from '@diet/shared';
import { cn } from '@/lib/utils';

/** 프로필 사진 주소 (DEC-104). avatarId 는 사진이 바뀌면 주소도 바뀌게 붙인다(접근 판정은 서버가 매번 한다) */
export function avatarUrl(userId: string, avatarId: string, thumb = true): string {
  return `${API_PREFIX}/profiles/${userId}/avatar?${thumb ? 'size=thumb&' : ''}v=${avatarId}`;
}

/**
 * 프로필 사진 동그라미. 사진이 없거나 불러오지 못하면(볼 수 없는 사람·파일 없음) 닉네임 첫 글자를 보인다.
 * 크기는 className 의 size-* 로 준다. src 로 아직 저장하지 않은 미리보기를 넘길 수 있다.
 */
export function Avatar({
  userId,
  nickname,
  avatarId,
  src,
  className,
}: {
  userId: string;
  nickname: string;
  avatarId: string | null;
  src?: string;
  className?: string;
}) {
  const url = src ?? (avatarId ? avatarUrl(userId, avatarId) : null);
  // 실패한 주소를 기억한다: 주소가 바뀌면 다시 시도한다
  const [failed, setFailed] = useState<string | null>(null);
  // 부르는 쪽 className 을 맨 뒤에 둔다: 크기·글자 크기·배경을 덮어쓸 수 있어야 한다
  const base = 'size-9 shrink-0 rounded-full border border-border';
  if (url && failed !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailed(url)}
        className={cn(base, 'bg-muted object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        base,
        'flex items-center justify-center bg-card text-sm font-semibold',
        className,
      )}
    >
      {Array.from(nickname)[0] ?? '?'}
    </span>
  );
}
