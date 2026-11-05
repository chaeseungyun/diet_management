import Link from 'next/link';
import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState } from '@/components/ui/card';

/** 식단 템플릿 목록 (S-20) */
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
          새 템플릿
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Link href="/plans/weekly" className={buttonClasses('outline', 'default', 'h-12')}>
          주간 반복 계획
        </Link>
        <Link href="/plans/calendar" className={buttonClasses('outline', 'default', 'h-12')}>
          캘린더·날짜 예외
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">템플릿</h2>
        <Link
          href={showArchived ? '/plans' : '/plans?archived=true'}
          className="text-xs text-accent-foreground"
        >
          {showArchived ? '활성 보기' : '보관 보기'}
        </Link>
      </div>
      {templates.length === 0 ? (
        <EmptyState>
          {showArchived
            ? '보관된 템플릿 없음'
            : '템플릿이 없습니다. 슬롯에 넣을 제품·수량 묶음을 만들어 두면 "먹었음" 1탭으로 기록할 수 있습니다.'}
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
                      주간 {t.usage.weeklyCells}셀 · 예정 예외 {t.usage.upcomingOverrides}건
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p>{Math.round(t.nutrition.kcal)} kcal</p>
                    {!t.nutrition.complete ? (
                      <Badge variant="warning">영양 불완전</Badge>
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
