'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { dateLabel } from '@/lib/format';

/** S-50 날짜별 목록: 수정(덮어쓰기)·삭제 */
export function WeightList({ items }: { items: Schemas['WeightDto'][] }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');

  async function save(date: string) {
    try {
      await run(
        () => api('PUT', `/weights/${date}`, { weightKg: Number(value), overwrite: true }),
        '수정됨',
      );
      setEditing(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function remove(date: string) {
    try {
      await run(() => api('DELETE', `/weights/${date}`), '삭제됨 (미측정)');
      router.refresh();
    } catch {
      // 배너
    }
  }

  if (items.length === 0) return <EmptyState>기록 없음</EmptyState>;
  return (
    <div className="flex flex-col gap-1">
      <StatusBanner status={status} />
      <ul className="divide-y divide-border rounded-xl border border-border text-sm">
        {items.map((w) => (
          <li key={w.date} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-muted-foreground">{dateLabel(w.date)}</span>
            {editing === w.date ? (
              <span className="flex items-center gap-1">
                <Input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 w-24"
                  aria-label="체중"
                />
                <Button className="h-8 px-2 text-xs" onClick={() => save(w.date)}>
                  저장
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  onClick={() => setEditing(null)}
                >
                  취소
                </Button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="font-medium"
                  onClick={() => {
                    setEditing(w.date);
                    setValue(String(w.weightKg));
                  }}
                >
                  {w.weightKg} kg
                </button>
                <button
                  type="button"
                  aria-label="삭제"
                  onClick={() => remove(w.date)}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
