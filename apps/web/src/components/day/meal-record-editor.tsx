'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PLAN_TYPE_LABELS, formatQuantity, type MealSlot, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, newIdempotencyKey } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { ProductPicker } from '@/components/products/product-picker';

type Record = Schemas['MealRecordDto'];
type Item = Schemas['MealItemDto'];

interface EditItem {
  productId: string;
  productName: string;
  quantity: string;
  unit: StockUnit;
  allowedUnits: StockUnit[];
  displayUnit: string;
  isStockTracked: boolean;
  nutritionRegistered: boolean;
  plannedQuantity: number | null;
  saved: Item | null;
}

function fromItem(i: Item): EditItem {
  const q = i.actualQuantity ?? i.plannedQuantity;
  return {
    productId: i.productId ?? '',
    productName: i.productName,
    quantity: q === null ? '' : String(q),
    unit: i.unit,
    allowedUnits: i.allowedUnits,
    displayUnit: i.displayUnit,
    isStockTracked: i.isStockTracked,
    nutritionRegistered: i.nutritionRegistered,
    plannedQuantity: i.plannedQuantity,
    saved: i.id ? i : null,
  };
}

/**
 * S-11 식사 슬롯 상세·기록 + S-12 외부 식사 모드.
 * 저장은 항상 PUT 상태 설정 + version (D-04, D-08). 재고 부족은 막지 않고 '재고 확인 필요' 로 표시.
 */
export function MealRecordEditor({
  initial,
  date,
  slot,
}: {
  initial: Record;
  date: string;
  slot: MealSlot;
}) {
  const router = useRouter();
  const { status, run, set } = useStatus();
  const [record, setRecord] = useState<Record>(initial);
  const [kind, setKind] = useState<'home' | 'outside'>(
    initial.status === 'eaten' ? initial.kind : initial.planType === 'outside' ? 'outside' : 'home',
  );
  const [items, setItems] = useState<EditItem[]>(initial.items.map(fromItem));
  const [menu, setMenu] = useState(initial.outsideMenu ?? '');
  const [outside, setOutside] = useState({
    kcal: initial.outsideNutrition.kcal?.toString() ?? '',
    carbG: initial.outsideNutrition.carbG?.toString() ?? '',
    proteinG: initial.outsideNutrition.proteinG?.toString() ?? '',
    fatG: initial.outsideNutrition.fatG?.toString() ?? '',
  });
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  async function save(nextStatus: 'eaten' | 'skipped' | 'unrecorded') {
    setBusy(true);
    try {
      const body =
        nextStatus === 'eaten'
          ? {
              status: 'eaten',
              kind,
              items: items.map((i) => ({
                productId: i.productId,
                quantity: num(i.quantity),
                unit: i.unit,
              })),
              ...(kind === 'outside'
                ? {
                    outsideMenu: menu,
                    outsideKcal: num(outside.kcal),
                    outsideCarbG: num(outside.carbG),
                    outsideProteinG: num(outside.proteinG),
                    outsideFatG: num(outside.fatG),
                  }
                : {}),
              version: record.version,
            }
          : { status: nextStatus, version: record.version };
      const saved = await run(
        () =>
          api<Record>('PUT', `/meal-records/${date}/${slot}`, body, {
            idempotencyKey: newIdempotencyKey(),
          }),
        nextStatus === 'eaten'
          ? '먹었음으로 저장'
          : nextStatus === 'skipped'
            ? '안 먹음으로 저장'
            : '미기록으로 되돌림 (재고 복구)',
      );
      setRecord(saved);
      setItems(saved.items.map(fromItem));
      setKind(saved.status === 'eaten' ? saved.kind : kind);
      setConflict(false);
      router.refresh();
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 409)
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const fresh = await api<Record>('GET', `/meal-records/${date}/${slot}`);
    setRecord(fresh);
    setItems(fresh.items.map(fromItem));
    setConflict(false);
    set({ kind: 'idle' });
  }

  function update(idx: number, patch: Partial<EditItem>) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const totals = record.nutrition;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            record.status === 'eaten'
              ? 'success'
              : record.status === 'skipped'
                ? 'secondary'
                : 'outline'
          }
        >
          {record.status === 'eaten'
            ? '먹었음'
            : record.status === 'skipped'
              ? '안 먹음'
              : '미기록'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          계획: {PLAN_TYPE_LABELS[record.planType]}
          {record.templateName ? ` · ${record.templateName}` : ''}
          {record.planSource === 'override' ? ' (날짜 예외)' : ''}
        </span>
        {record.stockCheckNeeded ? <Badge variant="warning">재고 확인 필요</Badge> : null}
      </div>

      <StatusBanner status={status} />
      {conflict ? (
        <Button variant="outline" onClick={reload}>
          새로 고침 후 다시 시도
        </Button>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant={kind === 'home' ? 'default' : 'outline'}
          className="h-8 flex-1 text-xs"
          onClick={() => setKind('home')}
        >
          집 제품
        </Button>
        <Button
          variant={kind === 'outside' ? 'default' : 'outline'}
          className="h-8 flex-1 text-xs"
          onClick={() => setKind('outside')}
        >
          외부 식사
        </Button>
      </div>

      {kind === 'outside' ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <Field label="메뉴명" htmlFor="menu">
              <Input
                id="menu"
                value={menu}
                onChange={(e) => setMenu(e.target.value)}
                placeholder="예: 김치찌개"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              영양 추정값은 직접 입력합니다. 비우면 '미상' 으로 남고 메뉴명으로 자동 계산하지
              않습니다 (FR-05).
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(['kcal', 'carbG', 'proteinG', 'fatG'] as const).map((k) => (
                <Field
                  key={k}
                  label={{ kcal: 'kcal', carbG: '탄(g)', proteinG: '단(g)', fatG: '지(g)' }[k]}
                  htmlFor={`o-${k}`}
                >
                  <Input
                    id={`o-${k}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={outside[k]}
                    onChange={(e) => setOutside({ ...outside, [k]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              아래 품목은 '추가한 집 제품' 으로, 이 항목만 재고를 차감합니다.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">품목</h2>
            <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPicker(true)}>
              <Plus className="size-4" /> 품목 추가
            </Button>
          </div>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">품목 없음</p> : null}
          {items.map((it, idx) => (
            <div
              key={`${it.productId}-${idx}`}
              className="flex flex-col gap-1 rounded-lg border border-border p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{it.productName}</span>
                <button
                  type="button"
                  aria-label="제외"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  aria-label="실제량"
                  value={it.quantity}
                  placeholder={it.isStockTracked ? '실제량' : '기본 추정량'}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                />
                <Select
                  aria-label="단위"
                  value={it.unit}
                  onChange={(e) => update(idx, { unit: e.target.value as StockUnit })}
                >
                  {it.allowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u === 'ea' ? it.displayUnit : u}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {it.plannedQuantity !== null ? (
                  <span>
                    예정 {formatQuantity(it.plannedQuantity)}
                    {it.displayUnit}
                  </span>
                ) : null}
                {it.saved ? (
                  <span>
                    ·{' '}
                    {it.saved.nutrition.kcal === null
                      ? '열량 미상'
                      : `${Math.round(it.saved.nutrition.kcal)} kcal`}
                    {it.saved.nutritionSource === 'backfill' ? ' (사후 보완)' : ''}
                  </span>
                ) : null}
                {!it.nutritionRegistered ? <Badge variant="warning">영양 미등록</Badge> : null}
                {!it.isStockTracked ? <Badge variant="secondary">재고 비관리</Badge> : null}
                {it.saved?.stockCheckNeeded ? (
                  <Badge variant="warning">재고 확인 필요</Badge>
                ) : null}
                {it.allowedUnits.length === 1 && it.unit === 'ea' ? (
                  <span>· 단위 중량 없음 → g 입력 불가</span>
                ) : null}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {record.status === 'eaten' ? '실제 합계' : '계획 기준 예상'}:{' '}
            {totals.missing > 0 && totals.kcal === 0
              ? '열량 미상'
              : `${Math.round(totals.kcal)} kcal`}{' '}
            · 단백질 {formatQuantity(totals.proteinG, 1)}g
            {totals.missing > 0 ? ` · 미상 ${totals.missing}건` : ''}. 저장하면 실제량 기준으로 다시
            계산됩니다.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          onClick={() => save('eaten')}
          disabled={busy || (kind === 'outside' && menu.trim() === '')}
        >
          {record.status === 'eaten' ? '수정 저장' : '먹었음'}
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => save('skipped')}
          disabled={busy || record.status === 'skipped'}
        >
          안 먹음
        </Button>
        {record.status !== 'unrecorded' ? (
          <Button
            variant="ghost"
            className="col-span-2 text-destructive"
            onClick={() => save('unrecorded')}
            disabled={busy}
          >
            취소 (미기록으로, 재고 복구)
          </Button>
        ) : null}
      </div>

      <Dialog open={picker} onClose={() => setPicker(false)} title="품목 추가">
        <ProductPicker
          autoFocus
          exclude={items.map((i) => i.productId)}
          onPick={(p) => {
            setItems([
              ...items,
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
                isStockTracked: p.isStockTracked,
                nutritionRegistered: p.nutrition !== null,
                plannedQuantity: null,
                saved: null,
              },
            ]);
            setPicker(false);
          }}
        />
      </Dialog>
    </div>
  );
}
