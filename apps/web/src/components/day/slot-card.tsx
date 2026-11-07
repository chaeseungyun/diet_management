'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Circle, Minus } from 'lucide-react';
import { SLOT_LABELS, formatQuantity, type MealSlot } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, newIdempotencyKey } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';

type Record = Schemas['MealRecordDto'];

/** S-10 ③ 슬롯 카드. '먹었음' 1탭은 계획 그대로 상태 설정 (D-04) */
export function SlotCard({
  record,
  date,
  highlight,
}: {
  record: Record;
  date: string;
  highlight: boolean;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [busy, setBusy] = useState(false);
  const canQuickEat =
    record.status === 'unrecorded' && record.planType === 'template' && record.items.length > 0;

  async function quickEat() {
    setBusy(true);
    try {
      await run(async () => {
        await api(
          'PUT',
          `/meal-records/${date}/${record.slot}`,
          {
            status: 'eaten',
            kind: 'home',
            items: record.items.map((i) => ({
              productId: i.productId,
              quantity: i.isStockTracked ? i.plannedQuantity : (i.plannedQuantity ?? null),
              unit: i.unit,
            })),
            version: record.version,
          },
          { idempotencyKey: newIdempotencyKey() },
        );
        router.refresh();
      }, '먹었음으로 기록');
    } catch {
      // 배너가 표시한다
    } finally {
      setBusy(false);
    }
  }

  const statusBadge =
    record.status === 'eaten' ? (
      <Badge variant="success">
        <Check className="size-3" /> 먹었음
      </Badge>
    ) : record.status === 'skipped' ? (
      <Badge variant="secondary">
        <Minus className="size-3" /> 안 먹음
      </Badge>
    ) : (
      <Badge variant="outline">
        <Circle className="size-3" /> 미기록
      </Badge>
    );

  const summary =
    record.status === 'eaten' && record.kind === 'outside'
      ? `식단 외 · ${record.outsideMenu ?? ''}`
      : record.items.length > 0
        ? record.items
            .map(
              (i) =>
                `${i.productName} ${formatQuantity(i.actualQuantity ?? i.plannedQuantity)}${i.displayUnit}`,
            )
            .join(', ')
        : record.planType === 'none'
          ? '자유 끼니 · 먹었으면 기록'
          : '품목 없음';

  return (
    <Card className={cn('flex flex-col gap-2 p-3', highlight && 'ring-2 ring-ring/40')}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/day/${date}/${record.slot as MealSlot}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{SLOT_LABELS[record.slot]}</span>
            {record.planType === 'none' ? <Badge variant="secondary">자유 끼니</Badge> : null}
            {record.planType === 'template' && record.templateName ? (
              <span className="text-xs text-muted-foreground">{record.templateName}</span>
            ) : null}
            {record.planSource === 'override' ? <Badge variant="outline">예외</Badge> : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {record.status === 'unrecorded' && record.planType === 'template' ? '예상 ' : ''}
            {record.nutrition.missing > 0 && record.nutrition.kcal === 0
              ? '열량 미상'
              : `${Math.round(record.nutrition.kcal)} kcal`}
            {record.nutrition.missing > 0 && record.nutrition.kcal > 0 ? ' (일부 미상)' : ''}
            {record.stockCheckNeeded ? ' · 남은 양 확인 필요' : ''}
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {statusBadge}
          {canQuickEat ? (
            <Button size="default" className="h-8 px-3 text-xs" onClick={quickEat} disabled={busy}>
              먹었음
            </Button>
          ) : (
            <Link
              href={`/day/${date}/${record.slot as MealSlot}`}
              className="text-xs text-accent-foreground"
            >
              {record.status === 'unrecorded' ? '기록' : '수정'}
            </Link>
          )}
        </div>
      </div>
      <StatusBanner status={status} />
    </Card>
  );
}
