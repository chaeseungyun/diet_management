'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { displayUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export type ProductDto = Schemas['ProductDto'];

/** 식품 검색·선택 (S-11 품목 추가, S-21, S-34). 없으면 S-31 로 */
export function ProductPicker({
  onPick,
  exclude = [],
  autoFocus,
}: {
  onPick: (p: ProductDto) => void;
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      api<ProductDto[]>('GET', `/products?q=${encodeURIComponent(q)}`)
        .then((list) => {
          if (alive) setItems(list);
        })
        .catch(() => {
          if (alive) setItems([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const visible = items.filter((p) => !exclude.includes(p.id));

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="식품 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        aria-label="식품 검색"
      />
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {visible.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="min-w-0 truncate">
                {p.name}
                {p.brand ? <span className="text-muted-foreground"> · {p.brand}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {p.nutrition === null ? <Badge variant="warning">영양 미등록</Badge> : null}
                {!p.isStockTracked ? <Badge variant="secondary">수량 안 셈</Badge> : null}
                {displayUnit(p)}
              </span>
            </button>
          </li>
        ))}
        {!loading && visible.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            검색 결과 없음.{' '}
            <Link href="/products/new" className="text-accent-foreground underline">
              새 식품 등록
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
