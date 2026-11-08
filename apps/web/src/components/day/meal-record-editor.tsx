'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Minus, Plus, Trash2, Undo2 } from 'lucide-react';
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
import { PlanCellDialog } from '@/components/plans/plan-cell-dialog';
import { cn } from '@/lib/utils';

type MealRecord = Schemas['MealRecordDto'];
type Item = Schemas['MealItemDto'];
type Template = Schemas['TemplateDto'];
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

const EMPTY_OUTSIDE: OutsideValues = { kcal: '', carbG: '', proteinG: '', fatG: '' };

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

/**
 * S-11 식사 슬롯 상세·기록 + S-12 식단 외 식사 모드 (D-20).
 *
 * 상태 버튼은 '먹었음'·'안 먹음' 둘뿐이다. 미기록은 고르는 상태가 아니라 기록이 없는 기본값이라
 * 기록이 있을 때만 '기록 취소' 로 되돌린다. 데이터 상태 3개와 3×3 전이(D-04)는 그대로다.
 *
 * 두 모드:
 * - 기록 전: 식단 끼니는 계획 요약 + '먹었음' 1탭(계획 그대로) + '다르게 먹었음'(편집기 열기).
 *   자유 끼니는 '먹었음' 을 누르면 무엇을 먹었는지(식단에서 고르기 / 내 식품 / 식단 외 식사) 고른 뒤 편집기.
 * - 기록 후: 기록된 내용 편집기, 변경이 있을 때만 '변경 사항 저장'.
 *
 * 저장은 항상 PUT 상태 설정 + version (D-04, D-08). 재고 부족은 막지 않고 '남은 양 확인 필요' 로 표시.
 * 품목이 없는 '먹었음' 은 서버가 422 로 거부하므로(DEC-057) 버튼에서도 막는다.
 */
export function MealRecordEditor({
  initial,
  date,
  slot,
  today,
  templates,
  autoStart = false,
}: {
  initial: MealRecord;
  date: string;
  slot: MealSlot;
  today: string;
  /** 활성 식단 전체. '식단 추가'(품목 채우기)와 날짜 예외 선택에 쓴다 */
  templates: Template[];
  /** 오늘 화면의 '먹었음' 에서 들어왔을 때 자유 끼니의 선택 시트를 바로 연다 */
  autoStart?: boolean;
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
  // 기록 전에는 편집기를 닫아 두고, 기록 후에는 항상 연다
  const [editing, setEditing] = useState(initial.status === 'eaten');
  const [chooser, setChooser] = useState(
    autoStart && initial.planType === 'none' && initial.status !== 'eaten',
  );
  const [picker, setPicker] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [planDialog, setPlanDialog] = useState(false);

  const eaten = record.status === 'eaten';
  const skipped = record.status === 'skipped';
  const recorded = record.status !== 'unrecorded';
  const isFree = record.planType === 'none';
  // 계획 바꾸기(날짜 예외, D-01): 식단 끼니의 미래 날짜만 (D-19). 오늘·과거는 기록으로 말하고,
  // 자유 끼니에는 바꿀 계획이 없으므로 버튼을 두지 않는다(미래 자유 끼니의 계획은 캘린더에서)
  const canChangePlan = !eaten && date > today && record.planType === 'template';

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
    ? "품목이 없으면 '먹었음' 으로 저장할 수 없습니다. 식단이나 식품을 추가하거나 '안 먹음' 을 고르세요."
    : kind === 'outside' && menu.trim() === ''
      ? '식단 외 식사는 메뉴명을 입력해야 저장됩니다.'
      : null;

  function applySaved(saved: MealRecord) {
    const d = draftFromRecord(saved);
    setRecord(saved);
    setItems(d.items);
    if (saved.status === 'eaten') {
      setKind(d.kind);
      setMenu(d.menu);
      setOutside(d.outside);
      setBaseline(draftKey(d.kind, d.items, d.menu, d.outside));
      setEditing(true);
    } else {
      // 안 먹음·기록 취소: 초안을 계획으로 되돌리고 편집기를 닫는다
      setKind('home');
      setMenu('');
      setOutside(EMPTY_OUTSIDE);
      setBaseline(draftKey('home', d.items, '', EMPTY_OUTSIDE));
      setEditing(false);
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
          ? eaten
            ? '변경 사항 저장'
            : '먹었음으로 저장'
          : `${nextStatus === 'skipped' ? '안 먹음으로 저장' : '기록 취소'}${
              eaten ? ' (뺐던 양 되돌림)' : ''
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

  /** 편집기를 연다. 자유 끼니의 세 갈래와 식단 끼니의 '다르게 먹었음' 이 여기로 온다 */
  function startEditing(nextKind: Kind, open?: 'template' | 'product') {
    setKind(nextKind);
    setEditing(true);
    setChooser(false);
    if (open === 'template') setTemplatePicker(true);
    if (open === 'product') setPicker(true);
  }

  /** 편집기를 닫고 초안을 저장된 기록(또는 계획)으로 되돌린다 */
  function cancelEditing() {
    const d = draftFromRecord(record);
    setKind(d.kind);
    setItems(d.items);
    setMenu(d.menu);
    setOutside(d.outside);
    setEditing(false);
  }

  /** '먹었음': 식단 끼니는 계획 그대로 즉시, 자유 끼니는 무엇을 먹었는지부터, 편집 중이면 그 내용으로 */
  function onEaten() {
    if (eaten) return;
    if (editing) {
      void save('eaten');
      return;
    }
    if (isFree || items.length === 0) {
      setChooser(true);
      return;
    }
    void save('eaten');
  }

  /** 식단의 품목을 통째로 가져온다. 이미 있는 식품은 건너뛰고(수량 유지), 보관된 식품은 넣지 않는다 */
  function addTemplate(t: Template) {
    const have = new Set(items.map((i) => i.productId));
    const added: EditItem[] = t.items
      .filter((i) => !i.productArchived && !have.has(i.productId))
      .map((i) => ({
        productId: i.productId,
        productName: i.productName,
        quantity: String(i.quantity),
        unit: i.unit,
        allowedUnits: i.allowedUnits,
        displayUnit: i.displayUnit,
        isStockTracked: i.isStockTracked,
        nutritionRegistered: i.nutritionRegistered,
        plannedQuantity: null,
        saved: null,
      }));
    setItems([...items, ...added]);
    setTemplatePicker(false);
  }

  function update(idx: number, patch: Partial<EditItem>) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const totals = record.nutrition;
  const eatenDisabled = busy || eaten || (editing && eatenBlocked);
  const hint = eaten
    ? "먹었음으로 기록됨. 내용을 고치면 아래 '변경 사항 저장' 으로 반영됩니다. '안 먹음' 으로 바꾸면 뺐던 양을 되돌립니다."
    : skipped
      ? "안 먹음으로 기록됨 (남은 양 변동 없음). 먹었으면 '먹었음' 을 누르세요."
      : editing
        ? "아래 내용을 채운 뒤 '먹었음으로 저장' 을 누르면 그대로 저장됩니다."
        : isFree
          ? "식단표에 없는 끼니입니다. 먹었으면 '먹었음' 을 눌러 무엇을 먹었는지 고르세요. 안 먹었으면 그냥 두어도 됩니다(집계에서 빠짐)."
          : "계획대로 먹었으면 '먹었음' 한 번이면 됩니다. 다르게 먹었으면 아래 '다르게 먹었음' 을 누르세요.";

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

      {/* 상태 버튼: 먹었음 / 안 먹음 (D-20). 저장된 상태를 강조한다 */}
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            aria-pressed={eaten}
            disabled={eatenDisabled}
            onClick={onEaten}
            className={cn(
              'flex h-11 items-center justify-center gap-1 rounded-lg text-sm font-medium transition-colors',
              'disabled:cursor-default',
              eaten
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 disabled:opacity-50',
            )}
          >
            <Check className="size-4" />
            {editing && !eaten ? '먹었음으로 저장' : '먹었음'}
          </button>
          <button
            type="button"
            aria-pressed={skipped}
            disabled={busy || skipped}
            onClick={() => save('skipped')}
            className={cn(
              'flex h-11 items-center justify-center gap-1 rounded-lg text-sm font-medium transition-colors',
              'disabled:cursor-default',
              skipped
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent/50 disabled:opacity-50',
            )}
          >
            <Minus className="size-4" />안 먹음
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {editing && !eaten && eatenBlockedReason ? (
          <p className="text-xs text-warning-foreground">{eatenBlockedReason}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {record.stockCheckNeeded ? <Badge variant="warning">남은 양 확인 필요</Badge> : null}
          {recorded ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save('unrecorded')}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              <Undo2 className="size-3" />
              기록 취소 · 기록 전으로 되돌림{eaten ? ' (뺐던 양 복구)' : ''}
            </button>
          ) : null}
        </div>
      </div>

      <StatusBanner status={status} />
      {conflict ? (
        <Button variant="outline" onClick={reload}>
          새로 고침 후 다시 시도
        </Button>
      ) : null}

      {/* 기록 전 · 식단 끼니: 계획 요약 + 다르게 먹었음 */}
      {!editing && !isFree ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold">계획된 식단</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                &apos;먹었음&apos; 을 누르면 이 내용 그대로 기록되고 남은 양에서 뺍니다.
              </p>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">품목 없음</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {items.map((it) => (
                  <li key={it.productId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{it.productName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {it.quantity === '' ? '—' : formatQuantity(Number(it.quantity))}
                      {it.displayUnit}
                      {!it.nutritionRegistered ? ' · 영양 미등록' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              계획 기준 예상:{' '}
              {totals.missing > 0 && totals.kcal === 0
                ? '열량 미확인'
                : `${Math.round(totals.kcal)} kcal`}{' '}
              · 단백질 {formatQuantity(totals.proteinG, 1)}g
              {totals.missing > 0 ? ` · 미확인 ${totals.missing}건` : ''}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => startEditing('home')}>
                다르게 먹었음
              </Button>
              <Button variant="outline" onClick={() => startEditing('outside')}>
                식단 외 식사로 기록
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 기록 전 · 자유 끼니: 설명만. 입력은 '먹었음' → 선택 시트에서 시작한다 */}
      {!editing && isFree ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <p className="font-medium">자유 끼니</p>
            <p className="text-xs text-muted-foreground">
              식단표에 넣지 않은 끼니입니다. 먹었으면 &apos;먹었음&apos; 을 눌러 식단에서 고르거나,
              내 식품을 고르거나, 식단 외 식사(배달·외식·본가 집밥)로 기록합니다. 기록하면 그날
              집계에 들어갑니다.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* 편집기: 기록 후 항상, 기록 전에는 '다르게 먹었음'·선택 시트 뒤에만 */}
      {editing ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {eaten ? '기록된 내용' : '먹었음으로 기록할 내용'}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {eaten
                    ? '고치면 아래 "변경 사항 저장" 으로 반영됩니다.'
                    : '내 식품은 남은 양에서 빼고, 식단 외 식사는 메뉴명·영양을 직접 적습니다(곁들인 내 식품만 뺍니다).'}
                </p>
              </div>
              {!eaten ? (
                <Button variant="ghost" className="h-8 px-2 text-xs" onClick={cancelEditing}>
                  닫기
                </Button>
              ) : null}
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
                  영양 추정값은 직접 입력합니다. 비우면 &apos;미확인&apos; 으로 남고 메뉴명으로 자동
                  계산하지 않습니다 (FR-05).
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
              <div className="flex items-center gap-1">
                {kind === 'home' ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => setTemplatePicker(true)}
                  >
                    <Plus className="size-4" /> 식단 추가
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  onClick={() => setPicker(true)}
                >
                  <Plus className="size-4" /> 품목 추가
                </Button>
              </div>
            </div>
            {kind === 'outside' ? (
              <p className="-mt-2 text-xs text-muted-foreground">
                식단 외 식사에 곁들여 먹은 내 식품만 적습니다. 이 항목만 남은 양에서 뺍니다.
              </p>
            ) : null}
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {kind === 'home'
                  ? "품목 없음. '식단 추가' 로 식단을 통째로 가져오거나 '품목 추가' 로 식품을 고르세요."
                  : '품목 없음'}
              </p>
            ) : null}
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
                        ? '열량 미확인'
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
            {eaten ? (
              <p className="text-xs text-muted-foreground">
                실제 합계:{' '}
                {totals.missing > 0 && totals.kcal === 0
                  ? '열량 미확인'
                  : `${Math.round(totals.kcal)} kcal`}{' '}
                · 단백질 {formatQuantity(totals.proteinG, 1)}g
                {totals.missing > 0 ? ` · 미확인 ${totals.missing}건` : ''}. 저장하면 실제량
                기준으로 다시 계산됩니다.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {editing && !eaten ? (
        <div className="flex flex-col gap-1">
          <Button size="lg" onClick={() => save('eaten')} disabled={busy || eatenBlocked}>
            먹었음으로 저장
          </Button>
          {eatenBlockedReason ? (
            <p className="text-xs text-muted-foreground">{eatenBlockedReason}</p>
          ) : null}
        </div>
      ) : null}

      {eaten && dirty ? (
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

      {/* 자유 끼니(또는 품목 없는 끼니)의 '먹었음': 무엇을 먹었는지 세 갈래 (D-20) */}
      <Dialog open={chooser} onClose={() => setChooser(false)} title="무엇을 먹었나요?">
        <ChoiceButton
          title="식단에서 고르기"
          description="만들어 둔 식단의 품목·수량을 그대로 가져옵니다. 식단표는 바뀌지 않습니다."
          onClick={() => startEditing('home', 'template')}
        />
        <ChoiceButton
          title="내 식품 고르기"
          description="식품을 하나씩 골라 먹은 양을 적습니다. 남은 양에서 뺍니다."
          onClick={() => startEditing('home', 'product')}
        />
        <ChoiceButton
          title="식단 외 식사"
          description="배달·외식·본가 집밥. 메뉴명과 영양 추정값(선택)을 적습니다. 남은 양 변동 없음."
          onClick={() => startEditing('outside')}
        />
      </Dialog>

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

      <Dialog open={templatePicker} onClose={() => setTemplatePicker(false)} title="식단 추가">
        <p className="text-xs text-muted-foreground">
          고른 식단의 품목·수량을 아래 목록에 넣습니다. 이미 있는 식품은 건너뜁니다. 식단표는 바뀌지
          않습니다.
        </p>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 식단이 없습니다. 식단 탭에서 먼저 만드세요.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => addTemplate(t)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-2 text-left text-sm hover:bg-accent/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.items.map((i) => i.productName).join(', ') || '품목 없음'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t.nutrition.complete
                      ? `${Math.round(t.nutrition.kcal)} kcal`
                      : '영양 일부 미확인'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

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

function ChoiceButton({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border p-3 text-left hover:bg-accent/50"
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
