'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Schemas } from '@/lib/api';
import { api, describeError } from '@/lib/client';
import { friendDayHref, type Friend } from '@/lib/friends';
import { Avatar, avatarUrl } from '@/components/ui/avatar';
import { buttonClasses } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Profile = Schemas['ProfileDto'];

/** 그 사이 볼 수 없게 된 프로필(친구 끊김·차단·탈퇴)은 404 로 온다 */
const GONE = { messages: { NOT_FOUND: '지금은 이 프로필을 볼 수 없어요.' } };

/**
 * 프로필 사진 버튼 + S-87 프로필 보기 시트 (DEC-104).
 * 누르면 큰 사진·닉네임·상태 메시지를 보인다. 나면 '프로필 편집', 볼 수 있는 친구면 '하루 보기'.
 */
export function ProfileButton({
  userId,
  nickname,
  avatarId,
  className,
}: {
  userId: string;
  nickname: string;
  avatarId: string | null;
  /** 동그라미 크기(size-*) */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${nickname} 프로필 보기`}
        className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar userId={userId} nickname={nickname} avatarId={avatarId} className={className} />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="프로필">
        {open ? <ProfileBody userId={userId} nickname={nickname} avatarId={avatarId} /> : null}
      </Dialog>
    </>
  );
}

function ProfileBody({
  userId,
  nickname,
  avatarId,
}: {
  userId: string;
  nickname: string;
  avatarId: string | null;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayHref, setDayHref] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Profile>('GET', `/profiles/${userId}`)
      .then(async (p) => {
        if (!alive) return;
        setProfile(p);
        if (!p.isFriend) return;
        // 끼니를 볼 수 있는 친구일 때만 '하루 보기' 를 낸다
        const friends = await api<Friend[]>('GET', '/friends').catch(() => [] as Friend[]);
        const f = friends.find((x) => x.userId === userId);
        if (alive && f) setDayHref(friendDayHref(f));
      })
      .catch((e: unknown) => alive && setError(describeError(e, GONE)));
    return () => {
      alive = false;
    };
  }, [userId]);

  // 불러오기 전에는 목록이 알고 있던 값으로 먼저 그린다
  const shown = profile ?? { nickname, avatarId, statusMessage: null, isMe: false };
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  return (
    <div className="flex flex-col items-center gap-3">
      {shown.avatarId && !photoFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl(userId, shown.avatarId, false)}
          alt={`${shown.nickname} 프로필 사진`}
          onError={() => setPhotoFailed(true)}
          className="max-h-[60dvh] w-full rounded-xl bg-muted object-contain"
        />
      ) : (
        <Avatar
          userId={userId}
          nickname={shown.nickname}
          avatarId={null}
          className="size-28 text-4xl"
        />
      )}
      <div className="flex w-full flex-col items-center gap-1 text-center">
        <p className="text-lg font-semibold">{shown.nickname}</p>
        {profile === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="불러오는 중" />
        ) : profile.statusMessage ? (
          <p className="break-words text-sm text-muted-foreground">{profile.statusMessage}</p>
        ) : null}
      </div>
      {shown.isMe ? (
        <Link href="/settings/profile" className={cn(buttonClasses('outline'), 'w-full')}>
          프로필 편집
        </Link>
      ) : dayHref ? (
        <Link href={dayHref} className={cn(buttonClasses('outline'), 'w-full')}>
          하루 보기
        </Link>
      ) : null}
    </div>
  );
}
