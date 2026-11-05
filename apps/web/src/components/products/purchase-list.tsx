'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  PURCHASE_STATUSES,
  PURCHASE_STATUS_LABELS,
  displayUnit,
  formatQuantity,
  type PurchaseStatus,
} from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, newIdempotencyKey } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';

type Purchase = Schemas['PurchaseDto'];

/** S-35: 받았음(입고 수량 기본 = 구매 수량 × 포장당 재고 단위, 수정 가능, D-11) / 취소 */
export function PurchaseList({
  purchases,
  status,
}: {
  purchases: Purchase[];
  status: PurchaseStatus;
}) {
  const router = useRouter();
  const { status: st, run } = useStatus();
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [qty, setQty] = useState('');

  async function receive() {
    if (!receiving) return;
    try {
      await run(
        () =>
          api(
            'POST',
            `/purchases/${receiving.id}/receive`,
            qty === '' ? {} : { quantity: Number(qty) },
            {
              idempotencyKey: newIdempotencyKey(),
            },
          ),
        '입고 처리 (재고 반영)',
      );
      setReceiving(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function cancel(p: Purchase) {
    try {
      await run(() => api('POST', `/purchases/${p.id}/cancel`), '주문 취소');
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm">
        {PURCHASE_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/purchases?status=${s}`}
            className={cn(
              'rounded-md px-2 py-1 text-center',
              s === status ? 'bg-card font-medium shadow-xs' : 'text-muted-foreground',
            )}
          >
            {PURCHASE_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>
      {status === 'ordered' ? (
        <p className="text-xs text-muted-foreground">배송 중 수량은 재고에 포함되지 않습니다.</p>
      ) : null}
      <StatusBanner status={st} />
      {purchases.length === 0 ? (
        <EmptyState>{PURCHASE_STATUS_LABELS[status]} 건 없음</EmptyState>
      ) : (
        purchases.map((p) => {
          const unit = displayUnit(p);
          return (
            <Card key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  <Link href={`/products/${p.productId}`}>{p.productName}</Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.purchasedOn} · {formatQuantity(p.quantity)}개 포장
                  {p.price !== null ? ` · ${p.price.toLocaleString()}원` : ''}
                  {p.receipt ? ` · 입고 ${formatQuantity(p.receipt.quantity)}${unit}` : ''}
                </p>
              </div>
              {p.status === 'ordered' ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setReceiving(p);
                      setQty(String(p.defaultReceiveQuantity));
                    }}
                  >
                    받았음
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground"
                    onClick={() => cancel(p)}
                  >
                    취소
                  </Button>
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      <Dialog open={receiving !== null} onClose={() => setReceiving(null)} title="받았음 처리">
        {receiving ? (
          <>
            <p className="text-sm">{receiving.productName}</p>
            <Field
              label={`입고 수량 (${displayUnit(receiving)})`}
              htmlFor="rq"
              hint={`기본값 = 구매 수량 ${formatQuantity(receiving.quantity)} × 포장당 재고 단위. 실제 받은 양이 다르면 고치세요`}
            >
              <Input
                id="rq"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            <Button onClick={receive}>입고</Button>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
