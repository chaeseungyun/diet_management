import { redirect } from 'next/navigation';
import { Check, ListChecks, PackageSearch, Scale } from 'lucide-react';
import { getMe } from '@/lib/api';
import { buttonClasses } from '@/components/ui/button';

/**
 * 랜딩·로그인 (S-01). 비로그인 접근은 모두 여기로 온다.
 * 앱이 무엇을 하는지, 시작하려면 무엇을 준비해야 하는지(식품 → 식단 → 식단표)를 보여 주고
 * 카카오 로그인으로 들어간다. 실패(state 불일치·거부)는 `?error=1` 로 돌아오며 사유를 표시하지 않는다(D-14).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getMe();
  if (me) redirect('/');
  const { error } = await searchParams;

  const kakaoButton = (
    <a
      href="/api/v1/auth/kakao"
      className={buttonClasses(
        'default',
        'lg',
        'w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90',
      )}
    >
      카카오로 시작하기
    </a>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-10 px-4 py-12 md:max-w-2xl">
      <section className="space-y-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          식단 · 식품 · 체중
        </p>
        <h1 className="text-3xl font-semibold leading-tight">
          매일 먹는 식단을 한 번 정해 두면, 기록은 1탭으로 끝납니다.
        </h1>
        <p className="text-muted-foreground">
          정해진 식단대로 먹는 사람을 위한 기록 앱입니다. 먹은 끼니를 체크하면 영양 합계가 쌓이고
          집에 있는 식품의 남은 양이 함께 줄어듭니다. 체중도 같은 화면에서 적습니다.
        </p>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground"
          >
            로그인에 실패했습니다. 다시 시도해 주세요.
          </p>
        ) : null}
        {kakaoButton}
        {process.env.NODE_ENV !== 'production' ? (
          <a href="/api/v1/auth/dev" className={buttonClasses('outline', 'default', 'w-full')}>
            개발용 계정으로 들어가기 (tester)
          </a>
        ) : null}
        <p className="text-xs text-muted-foreground">
          카카오 계정의 닉네임만 저장합니다. 계정과 데이터는 설정에서 삭제할 수 있습니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">이런 일을 합니다</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {[
            {
              Icon: Check,
              title: '끼니 체크',
              body: '아침·점심·저녁·간식마다 "먹었음" 한 번. 다르게 먹었으면 수량만 고칩니다. 외식은 메뉴명과 추정 영양을 적습니다.',
            },
            {
              Icon: PackageSearch,
              title: '남은 양 자동 계산',
              body: '먹은 만큼 남은 양이 줄고, 장본 것을 적으면 늘어납니다. 떨어질 날 예측은 다음 단계에서 추가됩니다.',
            },
            {
              Icon: Scale,
              title: '영양·체중 한눈에',
              body: '하루 영양 합계를 목표와 비교하고 체중 추세를 봅니다. 모르는 값은 0 이 아니라 "미확인" 으로 둡니다.',
            },
          ].map(({ Icon, title, body }) => (
            <li key={title} className="rounded-xl border border-border bg-card p-4">
              <Icon className="mb-2 size-5 text-primary" aria-hidden />
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="size-5" aria-hidden />
          시작할 때 준비할 것 세 가지
        </h2>
        <p className="text-sm text-muted-foreground">
          처음 한 번만 해 두면 됩니다. 로그인하면 오늘 화면에서 순서대로 안내합니다.
        </p>
        <ol className="space-y-2">
          {[
            [
              '식품 등록',
              '자주 먹는 식품을 이름과 포장 규격(예: 1박스 = 30팩)으로 등록합니다. 영양 성분은 나중에 채워도 됩니다.',
            ],
            ['식단', '한 끼에 먹는 식품과 수량을 묶습니다. 예: 아침 = 오트밀 50g + 우유 1팩.'],
            ['식단표', '요일·끼니마다 식단을 넣습니다. 출장 같은 예외는 날짜별로 바꿉니다.'],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-3 rounded-xl border border-border bg-card p-4">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3 rounded-xl border border-dashed border-border p-4">
        <h2 className="font-semibold">하루 사용 흐름</h2>
        <p className="text-sm text-muted-foreground">
          오늘 화면에서 끼니 카드의 &quot;먹었음&quot;을 누릅니다 → 영양 합계와 남은 양이 바로
          반영됩니다 → 체중을 적습니다. 먹지 않았으면 &quot;안 먹음&quot;, 잘못 눌렀으면
          &quot;미기록&quot;으로 되돌리면 남은 양도 되돌아갑니다.
        </p>
        {kakaoButton}
      </section>
    </main>
  );
}
