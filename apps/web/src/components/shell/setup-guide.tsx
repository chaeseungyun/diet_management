import Link from 'next/link';
import { Check, ChevronRight } from 'lucide-react';
import { apiGet, type Schemas } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Step {
  key: 'products' | 'templates' | 'weekly';
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
}

/** 세 가지 준비 상태. 판정은 '있다/없다' 뿐이라 웹에서 한다(NFR-07 의 업무 규칙이 아님) */
export async function loadSetupSteps(): Promise<Step[]> {
  const [products, templates, weekly] = await Promise.all([
    apiGet<Schemas['ProductDto'][]>('/products'),
    apiGet<Schemas['TemplateDto'][]>('/meal-templates'),
    apiGet<Schemas['WeeklyGridDto']>('/plans/weekly'),
  ]);
  return [
    {
      key: 'products',
      title: '식품 등록',
      description: '자주 먹는 식품을 이름·포장 규격으로 등록합니다. 영양은 나중에 채워도 됩니다.',
      href: '/products/new',
      action: '식품 등록하기',
      done: products.length > 0,
    },
    {
      key: 'templates',
      title: '식단 만들기',
      description:
        '한 끼에 먹는 식품과 수량을 묶은 것이 식단입니다. 예: 아침 = 오트밀 50g + 우유 1팩.',
      href: '/plans/templates/new',
      action: '식단 만들기',
      done: templates.length > 0,
    },
    {
      key: 'weekly',
      title: '식단표 채우기',
      description: '요일·끼니마다 식단을 넣으면 오늘 화면에서 "먹었음" 1탭으로 기록됩니다.',
      href: '/plans/weekly',
      action: '식단표 채우기',
      done: weekly.cells.some((c) => c.planType !== 'none'),
    },
  ];
}

/**
 * 시작 가이드. 식품 → 식단 → 식단표 순서를 보여 주고, 다음 할 일을 강조한다.
 * 세 단계가 모두 끝나면 아무것도 그리지 않는다.
 */
export async function SetupGuide({
  title = '시작하기',
  only,
}: {
  title?: string;
  /** 특정 단계부터만 보여 줄 때 (예: 식단 화면에서는 식품 단계를 접음) */
  only?: Step['key'][];
}) {
  const steps = await loadSetupSteps();
  if (steps.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done);
  const visible = only ? steps.filter((s) => only.includes(s.key)) : steps;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="flex flex-col gap-3 border-primary/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{steps.length} 완료
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        식사 기록을 1탭으로 끝내려면 아래 순서대로 한 번만 준비하면 됩니다.
      </p>
      <ol className="flex flex-col gap-2">
        {visible.map((s) => {
          const isNext = next?.key === s.key;
          return (
            <li
              key={s.key}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3',
                s.done
                  ? 'border-border bg-muted/40 text-muted-foreground'
                  : isNext
                    ? 'border-primary bg-card'
                    : 'border-border bg-card',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  s.done
                    ? 'bg-accent text-accent-foreground'
                    : isNext
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground',
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-3.5" /> : steps.indexOf(s) + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', s.done && 'line-through')}>{s.title}</p>
                {!s.done ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                ) : null}
                {isNext ? (
                  <Link
                    href={s.href}
                    className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    {s.action}
                    <ChevronRight className="size-4" />
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
