import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { buttonClasses } from '@/components/ui/button';

/**
 * 로그인 (S-01). 앱 소개 1줄 + 카카오 로그인 버튼.
 * 실패(state 불일치·거부)는 `?error=1` 로 돌아오며 사유를 표시하지 않는다(D-14).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getMe();
  if (me) redirect('/');
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">식단 관리</h1>
        <p className="text-muted-foreground">
          적은 입력으로 식사·영양·체중을 기록하고 식품이 떨어질 날을 미리 안다.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
          로그인에 실패했습니다. 다시 시도해 주세요.
        </p>
      ) : null}

      <a
        href="/api/v1/auth/kakao"
        className={buttonClasses(
          'default',
          'lg',
          'w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90',
        )}
      >
        카카오로 로그인
      </a>

      <p className="text-xs text-muted-foreground">
        카카오 계정의 닉네임만 저장합니다. 계정과 데이터는 설정에서 삭제할 수 있습니다.
      </p>
    </main>
  );
}
