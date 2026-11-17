'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { friendDayHref, PENDING_INVITE_KEY, type Friend } from '@/lib/friends';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

function forget() {
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // 저장소 접근 불가
  }
}

/**
 * S-82 비로그인: 로그인하러 가기 전에 코드를 이 탭에 적어 둔다.
 * 카카오 콜백은 `/` 로만 돌아오므로(D-14) InviteResume 이 이 값을 보고 다시 여기로 보낸다.
 */
export function InviteLogin({ code, dev }: { code: string; dev: boolean }) {
  const remember = () => {
    try {
      window.sessionStorage.setItem(PENDING_INVITE_KEY, code);
    } catch {
      // 저장하지 못하면 로그인 뒤 링크를 다시 열어야 한다
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <a
        href="/api/v1/auth/kakao"
        onClick={remember}
        className={buttonClasses(
          'default',
          'lg',
          'w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90',
        )}
      >
        카카오로 시작하고 수락하기
      </a>
      {dev ? (
        <a
          href="/api/v1/auth/dev"
          onClick={remember}
          className={buttonClasses('outline', 'default', 'w-full')}
        >
          개발용 계정으로 들어가기 (tester)
        </a>
      ) : null}
    </div>
  );
}

/** S-82 로그인 상태: 내 끼니 공개 토글 + 수락. 수락과 공개는 따로 저장한다 (DEC-090) */
export function InviteAccept({
  code,
  nickname,
  alreadyPublic,
}: {
  code: string;
  nickname: string;
  /** 이미 '친구에게 공개' 라면 토글을 보이지 않는다(끄는 것은 공유 설정에서) */
  alreadyPublic: boolean;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);

  // 로그인하고 돌아왔으면 적어 둔 코드는 할 일을 다 했다
  useEffect(forget, []);

  async function accept() {
    setBusy(true);
    let friend: Friend;
    try {
      friend = await run(
        () => api<Friend>('POST', `/friend-invites/${code}/accept`),
        `${nickname}님과 친구가 됐어요`,
        { messages: { NOT_FOUND: '이 링크는 더 이상 쓸 수 없어요. 새 링크를 부탁해 주세요.' } },
      );
    } catch {
      setBusy(false);
      return;
    }
    if (share && !alreadyPublic) {
      try {
        await api('PUT', '/me/sharing', { visibility: 'friends' });
      } catch {
        // 친구는 됐다. 공개만 실패했으니 공유 설정에서 직접 켜게 한다
        router.replace('/settings/sharing');
        return;
      }
    }
    router.replace(friendDayHref(friend) ?? '/friends');
  }

  return (
    <div className="flex flex-col gap-3">
      {alreadyPublic ? (
        <p className="text-sm text-muted-foreground">
          내 끼니는 친구에게 공개 중이라 {nickname}님에게도 보여요.
        </p>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3">
          <Checkbox
            label="내 끼니도 친구에게 공개하기"
            checked={share}
            disabled={busy}
            onChange={(e) => setShare(e.target.checked)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            켜면 내 친구 모두에게 끼니·사진·영양 합계가 보여요. 체중·목표·남은 양은 보이지 않아요.
            나중에 공유 설정에서 바꿀 수 있어요.
          </p>
        </div>
      )}
      <StatusBanner status={status} />
      <Button size="lg" onClick={accept} disabled={busy}>
        수락하고 친구 되기
      </Button>
      <Link href="/friends" className={buttonClasses('ghost', 'default', 'w-full')}>
        친구 목록으로
      </Link>
    </div>
  );
}

/** 로그인 영역 어디에 도착하든, 적어 둔 초대 코드가 있으면 S-82 로 보낸다 */
export function InviteResume() {
  const router = useRouter();
  useEffect(() => {
    let code: string | null = null;
    try {
      code = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    } catch {
      // 저장소 접근 불가
    }
    if (!code) return;
    forget();
    if (/^[A-Za-z0-9_-]{16,64}$/.test(code)) router.replace(`/invite/${code}`);
  }, [router]);
  return null;
}
