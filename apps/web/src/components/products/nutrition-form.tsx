'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { displayUnit, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Product = Schemas['ProductDetailDto'];

/**
 * S-33. 기준량·단위(재고 단위 또는 g), kcal, 탄·단·지(미입력은 null), 출처.
 * 저장 후 응답의 unknownSnapshotCount > 0 이면 D-03 확인 다이얼로그 → backfill (2단계, DEC-054).
 */
export function NutritionForm({ product }: { product: Product }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const cur = product.nutrition;
  const [f, setF] = useState({
    basisAmount: cur ? String(cur.basisAmount) : product.stockUnit === 'ea' ? '1' : '100',
    basisUnit: (cur?.basisUnit ?? product.stockUnit) as StockUnit,
    kcal: cur?.kcal?.toString() ?? '',
    carbG: cur?.carbG?.toString() ?? '',
    proteinG: cur?.proteinG?.toString() ?? '',
    fatG: cur?.fatG?.toString() ?? '',
    source: (cur?.source === 'manual_estimate' ? 'manual_estimate' : 'label') as
      'label' | 'manual_estimate',
  });
  const [unknown, setUnknown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = displayUnit(product);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await run(
        () =>
          api<Schemas['NutritionSaveResultDto']>('POST', `/products/${product.id}/nutrition`, {
            basisAmount: Number(f.basisAmount),
            basisUnit: f.basisUnit,
            kcal: num(f.kcal),
            carbG: num(f.carbG),
            proteinG: num(f.proteinG),
            fatG: num(f.fatG),
            source: f.source,
          }),
        '영양 정보 저장 (새 버전)',
      );
      if (res.unknownSnapshotCount > 0) {
        setUnknown(res.unknownSnapshotCount);
      } else {
        router.push(`/products/${product.id}`);
        router.refresh();
      }
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  async function backfill(apply: boolean) {
    if (apply) {
      try {
        await run(
          () =>
            api<Schemas['BackfillResultDto']>('POST', `/products/${product.id}/nutrition/backfill`),
          '영양 미상 기록 보완',
        );
      } catch {
        return;
      }
    }
    setUnknown(null);
    router.push(`/products/${product.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <StatusBanner status={status} />
      <p className="text-xs text-muted-foreground">
        기준량과 섭취량은 분리됩니다. 예: 프로틴 30g 기준 단백질 24g 이면, 45g 섭취 시 36g 으로
        계산됩니다 ("가루 45g ≠ 단백질 45g").
        {product.stockUnit === 'ea' ? ` "1회분" 은 재고 단위 수량(예: 1${unit})으로 적습니다.` : ''}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="기준량" htmlFor="basis">
          <Input
            id="basis"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            value={f.basisAmount}
            onChange={(e) => setF({ ...f, basisAmount: e.target.value })}
          />
        </Field>
        <Field
          label="기준 단위"
          htmlFor="bunit"
          hint={
            product.allowedUnits.length === 1
              ? '재고 단위와 같아야 함'
              : 'g 는 단위 중량이 있어 허용'
          }
        >
          <Select
            id="bunit"
            value={f.basisUnit}
            onChange={(e) => setF({ ...f, basisUnit: e.target.value as StockUnit })}
          >
            {product.allowedUnits.map((u) => (
              <option key={u} value={u}>
                {u === 'ea' ? unit : u}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="열량 (kcal)" htmlFor="kcal" hint="비우면 미상">
          <Input
            id="kcal"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.kcal}
            onChange={(e) => setF({ ...f, kcal: e.target.value })}
          />
        </Field>
        <Field label="단백질 (g)" htmlFor="pro">
          <Input
            id="pro"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.proteinG}
            onChange={(e) => setF({ ...f, proteinG: e.target.value })}
          />
        </Field>
        <Field label="탄수화물 (g)" htmlFor="carb">
          <Input
            id="carb"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.carbG}
            onChange={(e) => setF({ ...f, carbG: e.target.value })}
          />
        </Field>
        <Field label="지방 (g)" htmlFor="fat">
          <Input
            id="fat"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.fatG}
            onChange={(e) => setF({ ...f, fatG: e.target.value })}
          />
        </Field>
      </div>
      <Field label="출처" htmlFor="source">
        <Select
          id="source"
          value={f.source}
          onChange={(e) => setF({ ...f, source: e.target.value as 'label' | 'manual_estimate' })}
        >
          <option value="label">제품 표시값</option>
          <option value="manual_estimate">직접 입력 추정</option>
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">
        수정은 새 버전으로 저장되며 과거 기록(스냅샷)은 바뀌지 않습니다. 영양 미상으로 남은 과거
        기록이 있으면 저장 후 보완 여부를 묻습니다.
      </p>
      <Button type="submit" size="lg" disabled={busy}>
        저장
      </Button>

      <Dialog open={unknown !== null} onClose={() => backfill(false)} title="영양 미상 기록 보완">
        <p className="text-sm">
          이 제품을 먹었지만 영양이 미상으로 남은 기록이 <strong>{unknown}건</strong> 있습니다. 방금
          저장한 값으로 채울까요? 이미 값이 있는 기록은 바뀌지 않으며, 채운 기록에는 '사후 보완'
          출처가 남습니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => backfill(false)}>
            그대로 두기
          </Button>
          <Button onClick={() => backfill(true)}>{unknown}건 채우기</Button>
        </div>
      </Dialog>
    </form>
  );
}
