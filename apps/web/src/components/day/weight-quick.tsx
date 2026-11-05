'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Schemas } from '@/lib/api';
import { ApiError, api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

/** S-10 ⑥ 체중 빠른 입력. 같은 날 값이 있으면 덮어쓰기 확인 (FR-07) */
export function WeightQuick({
  date,
  weight,
}: {
  date: string;
  weight: Schemas['WeightDto'] | null;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [value, setValue] = useState(weight ? String(weight.weightKg) : '');
  const [confirm, setConfirm] = useState(false);

  async function save(overwrite: boolean) {
    try {
      await run(async () => {
        try {
          await api('PUT', `/weights/${date}`, { weightKg: Number(value), overwrite });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && !overwrite) {
            setConfirm(true);
            throw new Error('이미 기록된 날입니다. 덮어쓸까요?');
          }
          throw e;
        }
      }, '체중 저장');
      setConfirm(false);
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="kg"
          aria-label="체중 (kg)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-32"
        />
        <span className="text-sm text-muted-foreground">kg</span>
        {confirm ? (
          <Button variant="destructive" className="h-9" onClick={() => save(true)}>
            덮어쓰기
          </Button>
        ) : (
          <Button className="h-9" onClick={() => save(false)} disabled={value === ''}>
            저장
          </Button>
        )}
        <Link href="/weight" className="ml-auto text-xs text-accent-foreground">
          추이 보기
        </Link>
      </div>
      {weight ? (
        <p className="text-xs text-muted-foreground">이 날 기록 {weight.weightKg} kg</p>
      ) : (
        <p className="text-xs text-muted-foreground">미측정</p>
      )}
      <StatusBanner status={status} />
    </Card>
  );
}
