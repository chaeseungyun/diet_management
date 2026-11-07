'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Circle, Minus, Plus, Trash2 } from 'lucide-react';
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
import { PlanCellDialog, type TemplateRef } from '@/components/plans/plan-cell-dialog';
import { cn } from '@/lib/utils';

type MealRecord = Schemas['MealRecordDto'];
type Item = Schemas['MealItemDto'];
type Status = MealRecord['status'];
type Kind = 'home' | 'outside';

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

interface OutsideValues {
  kcal: string;
  carbG: string;
  proteinG: string;
  fatG: string;
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

/** 저장된 레코드에서 편집 초안을 만든다. 저장 후에도 같은 함수로 기준선을 다시 잡는다 */
function draftFromRecord(r: MealRecord): {
  kind: Kind;
  items: EditItem[];
  menu: string;
  outside: OutsideValues;
} {
  return {
    kind: r.status === 'eaten' ? r.kind : 'home',
    items: r.items.map(fromItem),
    menu: r.outsideMenu ?? '',
    outside: {
      kcal: r.outsideNutrition.kcal?.toString() ?? '',
      carbG: r.outsideNutrition.carbG?.toString() ?? '',
      proteinG: r.outsideNutrition.proteinG?.toString() ?? '',
      fatG: r.outsideNutrition.fatG?.toString() ?? '',
    },
  };
}

/** 변경 여부 판정용 키. 화면 표시용 필드는 제외한다 */
function draftKey(kind: Kind, items: EditItem[], menu: string, outside: OutsideValues): string {
  return JSON.stringify({
    kind,
    items: items.map((i) => [i.productId, i.quantity.trim(), i.unit]),
    ...(kind === 'outside' ? { menu: menu.trim(), outside } : {}),
  });
}

const STATUS_OPTIONS: { value: Status; label: string; Icon: typeof Check }[] = [
  { value: 'eaten', label: '먹었음', Icon: Check },
  { value: 'skipped', label: '안 먹음', Icon: Minus },
  { value: 'unrecorded', label: '미기록', Icon: Circle },
];

const STATUS_SELECTED_CLASS: Record<Status, string> = {
  eaten: 'bg-accent text-accent-foreground',
  skipped: 'bg-secondary text-secondary-foreground',
  unrecorded: 'bg-muted text-foreground',
};

/**
 * S-11 식사 슬롯 상세·기록 + S-12 식단 외 식사 모드.
 * 상태 선택기가 유일한 상태 변경 수단이다. 저장된 상태를 강조하고, 누르면 바로 저장한다('먹었음' 은 아래 품목으로).
 * 아래 '변경 사항 저장' 버튼은 이미 먹었음인 기록의 품목·식단 외 식사 입력을 고쳤을 때만 나타난다.
 * 품목이 없는 '먹었음' 은 서버가 422 로 거부하므로(DEC-057) 선택기에서도 막는다.
 * 저장은 항상 PUT 상태 설정 + version (D-04, D-08). 재고 부족은 막지 않고 '남은 양 확인 필요' 로 표시.
 */
export function MealRecordEditor({
  initial,
  date,
  slot,
  today,
  templates,
}: {
  initial: MealRecord;
  date: string;
  slot: MealSlot;
  today: string;
  templates: TemplateRef[];
}) {
  const router = useRouter();
  const { status, run, set } = useStatus();
  const [record, setRecord] = useState<MealRecord>(initial);
  const first = draftFromRecord(initial);
  const [kind, setKind] = useState<Kind>(first.kind);
  const [items, setItems] = useState<EditItem[]>(first.items);
  const [menu, setMenu] = useState(first.menu);
  const [outside, setOutside] = useState<OutsideValues>(first.outside);
  const [baseline, setBaseline] = useState(() =>
    draftKey(first.kind, first.items, first.menu, first.outside),
  );
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [planDialog, setPlanDialog] = useState(false);
  // 계획 바꾸기(날짜 예외, D-01): 아직 먹지 않은 오늘·미래 끼니만. 과거는 기록으로 말한다
  const canChangePlan = record.status !== 'eaten' && date >= today;

  async function changePlan(v: {
    planType: MealRecord['planType'];
    templateId: string | null;
    note?: string;
  }) {
    try {
      await run(
        () =>
          api('PUT', `/plans/overrides/${date}/${slot}`, {
            planType: v.planType,
            templateId: v.templateId,
            note: v.note?.trim() ? v.note.trim() : null,
          }),
        '이 날 계획 변경',
      );
      setPlanDialog(false);
      await reload();
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function clearPlanOverride() {
    try {
      await run(() => api('DELETE', `/plans/overrides/${date}/${slot}`), '예외 해제');
      setPlanDialog(false);
      await reload();
      router.refresh();
    } catch {
      // 배너
    }
  }

  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  const dirty = draftKey(kind, items, menu, outside) !== baseline;
  const noItems = kind === 'home' && items.length === 0;
  const eatenBlocked = (kind === 'outside' && menu.trim() === '') || noItems;
  const eatenBlockedReason = noItems
    ? "품목이 없으면 '먹었음' 으로 저장할 수 없습니다. 품목을 추가하거나 '안 먹음' 을 고르세요."
    : kind === 'outside' && menu.trim() === ''
      ? '식단 외 식사는 메뉴명을 입력해야 저장됩니다.'
      : null;

  function applySaved(saved: MealRecord) {
    const d = draftFromRecord(saved);
    setRecord(saved);
    setItems(d.items);
    // 안 먹음·미기록으로 바꿔도 입력 중이던 유형·식단 외 식사 값은 유지한다
    const nextKind = saved.status === 'eaten' ? d.kind : kind;
    setKind(nextKind);
    if (saved.status === 'eaten') {
      setMenu(d.menu);
      setOutside(d.outside);
      setBaseline(draftKey(d.kind, d.items, d.menu, d.outside));
    } else {
      setBaseline(draftKey(nextKind, d.items, menu, outside));
    }
    setConflict(false);
  }

  async function save(nextStatus: Status) {
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
          api<MealRecord>('PUT', `/meal-records/${date}/${slot}`, body, {
            idempotencyKey: newIdempotencyKey(),
          }),
        nextStatus === 'eaten'
          ? record.status === 'eaten'
            ? '변경 사항 저장'
            : '먹었음으로 저장'
          : `${nextStatus === 'skipped' ? '안 먹음으로 저장' : '미기록으로 되돌림'}${
              record.status === 'eaten' ? ' (남은 양 되돌림)' : ''
            }`,
      );
      applySaved(saved);
      router.refresh();
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 409)
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const fresh = await api<MealRecord>('GET', `/meal-records/${date}/${slot}`);
    applySaved(fresh);
    set({ kind: 'idle' });
  }

  function update(idx: number, patch: Partial<EditItem>) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const totals = record.nutrition;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          계획: {PLAN_TYPE_LABELS[record.planType]}
          {record.templateName ? ` · ${record.templateName}` : ''}
          {record.planSource === 'override' ? ' (날짜 예외)' : ''}
          {record.planNote ? ` · ${record.planNote}` : ''}
        </p>
        {canChangePlan ? (
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-accent-foreground"
            onClick={() => setPlanDialog(true)}
          >
            이 날은 다르게 먹을 예정
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <div
          role="radiogroup"
          aria-label="식사 상태"
          className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-card p-1"
        >
          {STATUS_OPTIONS.map(({ value, label, Icon }) => {
            const selected = record.status === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy || selected || (value === 'eaten' && eatenBlocked)}
                onClick={() => save(value)}
                className={cn(
                  'flex h-10 items-center justify-center gap-1 rounded-lg text-sm font-medium transition-colors',
                  'disabled:cursor-default',
                  selected
                    ? STATUS_SELECTED_CLASS[value]
                    : 'text-muted-foreground hover:bg-accent/50 disabled:opacity-50',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          현재 상태가 강조됩니다. 다른 상태를 누르면 바로 저장됩니다. '먹었음' 은 아래 내용 그대로
          기록하고, '안 먹음'·'미기록' 은 둘 다 남은 양을 빼지 않습니다(먹었음에서 바꾸면 뺐던 양을
          되돌립니다).
        </p>
        {record.status !== 'eaten' && eatenBlockedReason ? (
          <p className="text-xs text-warning-foreground">{eatenBlockedReason}</p>
        ) : null}
        {record.stockCheckNeeded ? (
          <Badge variant="warning" className="self-start">
            남은 양 확인 필요
          </Badge>
        ) : null}
      </div>

      <StatusBanner status={status} />
      {conflict ? (
        <Button variant="outline" onClick={reload}>
          새로 고침 후 다시 시도
        </Button>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div>
            <h2 className="text-sm font-semibold">
              {record.status === 'eaten' ? '기록된 내용' : '먹었음으로 기록할 내용'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {record.status === 'eaten'
                ? '고치면 아래 "변경 사항 저장" 으로 반영됩니다.'
                : "계획대로 먹었으면 그대로 위의 '먹었음' 을 누르세요. 배달·외식·본가 집밥처럼 내 식품을 안 썼으면 '식단 외 식사' 로 바꾼 뒤 누르세요."}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="식사 유형"
            className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            {(
              [
                ['home', '내 식품'],
                ['outside', '식단 외 식사'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => setKind(value)}
                className={cn(
                  'h-8 rounded-md text-xs font-medium transition-colors',
                  kind === value
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {kind === 'outside' ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
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
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {kind === 'outside' ? '곁들인 내 식품' : '품목'}
            </h3>
            <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPicker(true)}>
              <Plus className="size-4" /> 품목 추가
            </Button>
          </div>
          {kind === 'outside' ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              식단 외 식사에 곁들여 먹은 내 식품만 적습니다. 이 항목만 남은 양에서 뺍니다.
            </p>
          ) : null}
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
                {!it.isStockTracked ? <Badge variant="secondary">수량 안 셈</Badge> : null}
                {it.saved?.stockCheckNeeded ? (
                  <Badge variant="warning">남은 양 확인 필요</Badge>
                ) : null}
                {it.allowedUnits.length === 1 && it.unit === 'ea' ? (
                  <span>· 단위 중량 없음 → g 입력 불가</span>
                ) : null}
              </div>
            </div>
          ))}
          {record.status !== 'eaten' ? (
            <p className="text-xs text-muted-foreground">
              품목·수량을 고친 뒤 위의 &apos;먹었음&apos; 을 누르면 그 내용으로 저장됩니다.
            </p>
          ) : null}
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

      {record.status === 'eaten' && dirty ? (
        <div className="flex flex-col gap-1">
          <Button size="lg" onClick={() => save('eaten')} disabled={busy || eatenBlocked}>
            변경 사항 저장
          </Button>
          <p className="text-xs text-muted-foreground">
            {eatenBlockedReason ??
              '저장하면 이전에 뺀 남은 양을 되돌리고 새 품목·수량으로 다시 뺍니다.'}
          </p>
        </div>
      ) : null}

      {planDialog ? (
        <PlanCellDialog
          open
          title="이 날 이 끼니의 계획"
          initial={{
            planType: record.planType,
            templateId: record.templateId,
            note: record.planNote ?? '',
          }}
          templates={templates}
          withNote
          onClose={() => setPlanDialog(false)}
          onSave={changePlan}
          onClear={record.planSource === 'override' ? clearPlanOverride : undefined}
        />
      ) : null}

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
