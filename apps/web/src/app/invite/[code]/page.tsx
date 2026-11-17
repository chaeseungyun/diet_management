import Link from 'next/link';
import { apiFetch, getMe, type Schemas } from '@/lib/api';
import { buttonClasses } from '@/components/ui/button';
import { InviteAccept, InviteLogin } from '@/components/friends/invite-accept';

/**
 * 초대 수락 (S-82). 로그인 영역 밖이라 비로그인도 연다: 미리보기(초대한 사람 닉네임)만 공개 API 다.
 * 쓸 수 없는 링크(없음·만료·사용됨·지워짐)는 이유를 구분하지 않는다.
 */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [res, me] = await Promise.all([
    apiFetch(`/friend-invites/${encodeURIComponent(code)}`),
    getMe(),
  ]);
  if (!res.ok && res.status !== 404) throw new Error(`invite preview failed: ${res.status}`);
  const preview = res.ok ? ((await res.json()) as Schemas['FriendInvitePreviewDto']) : null;

  let alreadyPublic = false;
  if (preview && me) {
    const s = await apiFetch('/me/sharing');
    if (!s.ok) throw new Error(`GET /me/sharing failed: ${s.status}`);
    alreadyPublic = ((await s.json()) as Schemas['SharingSettingsDto']).visibility === 'friends';
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <p className="text-sm font-semibold text-muted-foreground">끼니로그</p>
      {preview ? (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-tight">
              {preview.nickname}님이 친구로 초대했어요
            </h1>
            <p className="text-muted-foreground">
              친구가 되면 서로 공개한 끼니와 식사 사진, 하루 영양 합계를 볼 수 있어요. 체중과 목표는
              보이지 않아요.
            </p>
          </div>
          {me ? (
            <InviteAccept code={code} nickname={preview.nickname} alreadyPublic={alreadyPublic} />
          ) : (
            <InviteLogin code={code} dev={process.env.NODE_ENV !== 'production'} />
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-tight">쓸 수 없는 초대 링크예요</h1>
            <p className="text-muted-foreground">
              이미 사용됐거나 기간이 지난 링크예요. 보낸 사람에게 새 링크를 부탁해 주세요.
            </p>
          </div>
          <Link href="/" className={buttonClasses('outline')}>
            끼니로그로 가기
          </Link>
        </>
      )}
    </main>
  );
}
