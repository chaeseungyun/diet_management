import Link from 'next/link';
import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { SetupGuide } from '@/components/shell/setup-guide';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState } from '@/components/ui/card';

/** 식단 목록 (S-20). 코드·API 의 '템플릿'(MealTemplate) 을 화면에서는 '식단' 이라 부른다 (DEC-060) */
export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === 'true';
  const templates = await apiGet<Schemas['TemplateDto'][]>(
    `/meal-templates${showArchived ? '?archived=true' : ''}`,
  );

  return (
    <Page
      title="식단"
      actions={
        <Link
          href="/plans/templates/new"
          className={buttonClasses('default', 'default', 'h-8 px-3 text-xs')}
        >
          새 식단
        </Link>
      }
    >
      <SetupGuide title="식단 준비" />
      <div className="grid grid-cols-2 gap-2">
        <Link href="/plans/weekly" className={buttonClasses('outline', 'default', 'h-12')}>
          식단표
        </Link>
        <Link href="/plans/calendar" className={buttonClasses('outline', 'default', 'h-12')}>
          캘린더·날짜 예외
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">식단</h2>
        <Link
          href={showArchived ? '/plans' : '/plans?archived=true'}
          className="text-xs text-accent-foreground"
        >
          {showArchived ? '활성 보기' : '보관 보기'}
        </Link>
      </div>
      {templates.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-3">
          {showArchived ? (
            '보관된 식단 없음'
          ) : (
            <>
              <span>
                아직 식단이 없습니다. 식단은 한 끼에 먹는 식품·수량 묶음이고, 식단표에 넣으면
                &quot;먹었음&quot; 1탭으로 기록됩니다.
              </span>
              <Link href="/plans/templates/new" className={buttonClasses('default', 'lg')}>
                첫 식단 만들기
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/plans/templates/${t.id}`}>
                <Card className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.items.length}개 품목 ·{' '}
                      {t.items.map((i) => i.productName).join(', ') || '비어 있음'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      식단표 {t.usage.weeklyCells}칸 · 예정 예외 {t.usage.upcomingOverrides}건
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p>{Math.round(t.nutrition.kcal)} kcal</p>
                    {!t.nutrition.complete ? (
                      <Badge variant="warning">영양 일부 미확인</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        단 {Math.round(t.nutrition.proteinG)}g
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
