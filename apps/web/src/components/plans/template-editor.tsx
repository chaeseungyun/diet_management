'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { formatQuantity, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { ProductPicker } from '@/components/products/product-picker';

type Template = Schemas['TemplateDto'];

interface Row {
  productId: string;
  productName: string;
  quantity: string;
  unit: StockUnit;
  allowedUnits: StockUnit[];
  displayUnit: string;
  nutritionKcal: number | null;
  nutritionRegistered: boolean;
  isStockTracked: boolean;
}

/** S-21: 템플릿명, 품목(식품·수량·단위·정렬), 영양 합계 미리보기(저장 결과 기준), 미등록 경고. 변경은 과거 스냅샷에 영향 없음 */
export function TemplateEditor({ template }: { template?: Template }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [name, setName] = useState(template?.name ?? '');
  const [rows, setRows] = useState<Row[]>(
    (template?.items ?? []).map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: String(i.quantity),
      unit: i.unit,
      allowedUnits: i.unit === 'g' && i.displayUnit !== 'g' ? ['ea', 'g'] : [i.unit],
      displayUnit: i.displayUnit,
      nutritionKcal: i.nutrition.kcal,
      nutritionRegistered: i.nutrition.kcal !== null,
      isStockTracked: i.isStockTracked,
    })),
  );
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setRows(next);
  }

  async function save() {
    setBusy(true);
    const body = {
      name,
      items: rows.map((r) => ({
        productId: r.productId,
        quantity: Number(r.quantity || '0'),
        unit: r.unit,
      })),
    };
    try {
      if (template) {
        const saved = await run(
          () => api<Template>('PUT', `/meal-templates/${template.id}`, body),
          '템플릿 저장',
        );
        setRows((prev) =>
          prev.map((r) => {
            const it = saved.items.find((i) => i.productId === r.productId);
            return it
              ? {
                  ...r,
                  nutritionKcal: it.nutrition.kcal,
                  nutritionRegistered: it.nutrition.kcal !== null,
                }
              : r;
          }),
        );
      } else {
        const created = await run(
          () => api<Template>('POST', '/meal-templates', body),
          '템플릿 생성',
        );
        router.push(`/plans/templates/${created.id}`);
      }
      router.refresh();
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!template) return;
    const archived = template.archivedAt !== null;
    try {
      await run(
        () => api('POST', `/meal-templates/${template.id}/${archived ? 'unarchive' : 'archive'}`),
        archived ? '보관 해제' : '보관됨',
      );
      router.refresh();
    } catch {
      // 배너 (주간 계획이 참조하면 422)
    }
  }

  const totals = template?.nutrition;

  return (
    <div className="flex flex-col gap-4">
      <StatusBanner status={status} />
      <Field label="템플릿명" htmlFor="tname">
        <Input
          id="tname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 평일 점심"
        />
      </Field>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">품목</h2>
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPicker(true)}>
          <Plus className="size-4" /> 식품 추가
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          품목이 없습니다. 식품이 없으면 검색창에서 새 식품을 등록하세요.
        </p>
      ) : null}
      {rows.map((r, idx) => (
        <div
          key={`${r.productId}-${idx}`}
          className="flex flex-col gap-1 rounded-lg border border-border p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{r.productName}</span>
            <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <button
                type="button"
                aria-label="위로"
                onClick={() => move(idx, -1)}
                className="rounded-md p-1 hover:text-foreground"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label="아래로"
                onClick={() => move(idx, 1)}
                className="rounded-md p-1 hover:text-foreground"
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label="삭제"
                onClick={() => setRows(rows.filter((_, i) => i !== idx))}
                className="rounded-md p-1 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              aria-label="수량"
              value={r.quantity}
              onChange={(e) =>
                setRows(rows.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
              }
            />
            <Select
              aria-label="단위"
              value={r.unit}
              onChange={(e) =>
                setRows(
                  rows.map((x, i) => (i === idx ? { ...x, unit: e.target.value as StockUnit } : x)),
                )
              }
            >
              {r.allowedUnits.map((u) => (
                <option key={u} value={u}>
                  {u === 'ea' ? r.displayUnit : u}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
            {r.nutritionKcal !== null ? (
              <span>{Math.round(r.nutritionKcal)} kcal (저장 기준)</span>
            ) : null}
            {!r.nutritionRegistered ? <Badge variant="warning">영양 미등록</Badge> : null}
            {!r.isStockTracked ? <Badge variant="secondary">수량 안 셈</Badge> : null}
          </div>
        </div>
      ))}
      {totals ? (
        <p className="text-sm">
          1회 합계 {Math.round(totals.kcal)} kcal · 단 {formatQuantity(totals.proteinG, 1)}g · 탄{' '}
          {formatQuantity(totals.carbG, 1)}g · 지 {formatQuantity(totals.fatG, 1)}g
          {!totals.complete ? (
            <Badge variant="warning" className="ml-2">
              영양 불완전 {totals.missing}건
            </Badge>
          ) : null}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        템플릿 변경은 이미 기록한 과거 식사에 영향을 주지 않습니다 (NFR-02).
      </p>
      <Button size="lg" onClick={save} disabled={busy || name.trim() === '' || rows.length === 0}>
        {template ? '저장' : '만들기'}
      </Button>
      {rows.length === 0 ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          품목을 1개 이상 넣어야 {template ? '저장' : '만들기'}할 수 있습니다.
        </p>
      ) : null}
      {template ? (
        <Button variant="ghost" className="text-muted-foreground" onClick={toggleArchive}>
          {template.archivedAt ? '보관 해제' : '보관 (주간 계획에서 쓰는 중이면 거부됨)'}
        </Button>
      ) : null}

      <Dialog open={picker} onClose={() => setPicker(false)} title="식품 추가">
        <ProductPicker
          autoFocus
          exclude={rows.map((r) => r.productId)}
          onPick={(p) => {
            setRows([
              ...rows,
              {
                productId: p.id,
                productName: p.name,
                quantity:
                  !p.isStockTracked && p.defaultServingAmount !== null
                    ? String(p.defaultServingAmount)
                    : '',
                unit: p.stockUnit,
                allowedUnits: p.allowedUnits,
                displayUnit: p.stockUnit === 'ea' ? (p.unitLabel ?? '개') : p.stockUnit,
                nutritionKcal: null,
                nutritionRegistered: p.nutrition !== null,
                isStockTracked: p.isStockTracked,
              },
            ]);
            setPicker(false);
          }}
        />
      </Dialog>
    </div>
  );
}
