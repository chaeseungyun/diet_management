'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SLOT_LABELS, formatQuantity } from '@diet/shared';
import type { components } from '@/lib/api-types';
import { api, describeError } from '@/lib/client';
import { MOVEMENT_REASON_LABELS, shortDate } from '@/lib/stock';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/card';

type MovementPage = components['schemas']['StockMovementPageDto'];

const TIME = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** 남은 양 변동 기록 (S-41). 최근 것부터. 고치거나 지울 수 없고, 잘못 적었으면 맞추기로 바로잡는다 */
export function MovementList({
  productId,
  unit,
  first,
}: {
  productId: string;
  unit: string;
  first: MovementPage;
}) {
  const [items, setItems] = useState(first.items);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<MovementPage>('GET', `/stock/${productId}/movements?cursor=${cursor}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) return <EmptyState>변동 기록 없음</EmptyState>;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((m) => (
          <li
            key={m.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p>
                {MOVEMENT_REASON_LABELS[m.reason]}
                {m.meal ? (
                  <Link
                    href={
                      m.meal.slot === 'extra'
                        ? `/day/${m.meal.date}`
                        : `/day/${m.meal.date}/${m.meal.slot}`
                    }
                    className="ml-1 text-xs text-accent-foreground underline"
                  >
                    {shortDate(m.meal.date)} {SLOT_LABELS[m.meal.slot]}
                  </Link>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {TIME.format(new Date(m.createdAt))}
                {m.note ? ` · ${m.note}` : ''}
              </p>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {m.delta > 0 ? '+' : m.delta < 0 ? '−' : '±'}
              {formatQuantity(Math.abs(m.delta))}
              {unit}
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <Button variant="outline" onClick={more} disabled={loading}>
          {loading ? '불러오는 중…' : '더 보기'}
        </Button>
      ) : null}
    </div>
  );
}
