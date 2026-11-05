'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Goal = Schemas['GoalDto'];

/** S-51 / S-03 공용: 목표 체중, 일일 kcal, 단백질(필수), 탄·지(선택), 적용 시작일(기본 오늘) */
export function GoalForm({
  current,
  today,
  onSaved,
  submitLabel = '새 목표 저장',
}: {
  current: Goal | null;
  today: string;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [f, setF] = useState({
    effectiveFrom: today,
    targetWeightKg: current?.targetWeightKg.toString() ?? '',
    dailyKcal: current?.dailyKcal.toString() ?? '',
    proteinG: current?.proteinG.toString() ?? '',
    carbG: current?.carbG?.toString() ?? '',
    fatG: current?.fatG?.toString() ?? '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await run(
        () =>
          api<Goal>('POST', '/goals', {
            effectiveFrom: f.effectiveFrom,
            targetWeightKg: Number(f.targetWeightKg),
            dailyKcal: Number(f.dailyKcal),
            proteinG: Number(f.proteinG),
            carbG: f.carbG === '' ? null : Number(f.carbG),
            fatG: f.fatG === '' ? null : Number(f.fatG),
          }),
        '목표 저장',
      );
      onSaved?.();
      router.refresh();
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <StatusBanner status={status} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="목표 체중 (kg)" htmlFor="g-w">
          <Input
            id="g-w"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            required
            value={f.targetWeightKg}
            onChange={(e) => setF({ ...f, targetWeightKg: e.target.value })}
          />
        </Field>
        <Field label="일일 열량 (kcal)" htmlFor="g-k">
          <Input
            id="g-k"
            type="number"
            inputMode="numeric"
            min="0"
            required
            value={f.dailyKcal}
            onChange={(e) => setF({ ...f, dailyKcal: e.target.value })}
          />
        </Field>
        <Field label="단백질 (g)" htmlFor="g-p">
          <Input
            id="g-p"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            value={f.proteinG}
            onChange={(e) => setF({ ...f, proteinG: e.target.value })}
          />
        </Field>
        <Field label="적용 시작일" htmlFor="g-d">
          <Input
            id="g-d"
            type="date"
            required
            value={f.effectiveFrom}
            onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
          />
        </Field>
        <Field label="탄수화물 (g, 선택)" htmlFor="g-c">
          <Input
            id="g-c"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.carbG}
            onChange={(e) => setF({ ...f, carbG: e.target.value })}
          />
        </Field>
        <Field label="지방 (g, 선택)" htmlFor="g-f">
          <Input
            id="g-f"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.fatG}
            onChange={(e) => setF({ ...f, fatG: e.target.value })}
          />
        </Field>
      </div>
      <Button type="submit" size="lg" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
