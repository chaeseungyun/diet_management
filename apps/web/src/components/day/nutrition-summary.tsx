import Link from 'next/link';
import type { Schemas } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatQuantity } from '@diet/shared';

/**
 * S-10 ② 영양 요약: 기록된 합계(primary) / 계획 포함 예상(planned) / 목표 대비(남음·초과, D-20).
 * 열량 진행률은 primary + planned 2단 채움 (design-tokens.md §4). 미상이 섞이면 '기록된 합계' 로 표시.
 */
export function NutritionSummary({ nutrition }: { nutrition: Schemas['DayNutritionDto'] }) {
  const { recorded, expected, goal } = nutrition;
  const target = goal?.dailyKcal ?? null;
  const pct = (v: number) => (target ? Math.min(100, (v / target) * 100) : 0);
  const over = target !== null && recorded.kcal > target;
  const diff = target !== null ? Math.round(Math.abs(target - recorded.kcal)) : 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">
              {recorded.complete ? '기록된 열량' : '기록된 합계 (영양 미상 포함)'}
            </p>
            <p className="text-2xl font-semibold">
              {Math.round(recorded.kcal)}{' '}
              <span className="text-sm font-normal text-muted-foreground">kcal</span>
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>계획 포함 예상 {Math.round(expected.kcal)} kcal</p>
            {target !== null ? (
              <p>
                목표 {target} kcal · {over ? `초과 ${diff}` : `남음 ${diff}`}
              </p>
            ) : (
              <Link href="/settings/goals" className="text-accent-foreground underline">
                목표 설정하기
              </Link>
            )}
          </div>
        </div>
        {target !== null ? (
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="absolute inset-y-0 left-0 bg-planned"
              style={{ width: `${pct(expected.kcal)}%` }}
            />
            <div
              className={
                over
                  ? 'absolute inset-y-0 left-0 bg-warning-foreground'
                  : 'absolute inset-y-0 left-0 bg-primary'
              }
              style={{ width: `${pct(recorded.kcal)}%` }}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Macro
            label="단백질"
            color="bg-chart-1"
            value={recorded.proteinG}
            target={goal?.proteinG ?? null}
          />
          <Macro
            label="탄수화물"
            color="bg-chart-2"
            value={recorded.carbG}
            target={goal?.carbG ?? null}
          />
          <Macro
            label="지방"
            color="bg-chart-3"
            value={recorded.fatG}
            target={goal?.fatG ?? null}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {recorded.missing > 0 ? (
            <Badge variant="warning">영양 미상 {recorded.missing}건</Badge>
          ) : null}
          {!expected.complete && expected.missing > recorded.missing ? (
            <Badge variant="outline">
              예상 합계에 미상 {expected.missing - recorded.missing}건
            </Badge>
          ) : null}
          {over ? <Badge variant="warning">목표 초과 +{diff} kcal</Badge> : null}
          {target !== null && !over && recorded.complete && recorded.kcal > 0 ? (
            <Badge variant="success">목표 내</Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Macro({
  label,
  color,
  value,
  target,
}: {
  label: string;
  color: string;
  value: number;
  target: number | null;
}) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span>
          {formatQuantity(value, 1)}g{target !== null ? ` / ${formatQuantity(target, 0)}g` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
