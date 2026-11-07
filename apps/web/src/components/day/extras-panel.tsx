'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatQuantity, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, newIdempotencyKey } from '@/lib/client';
import { Section } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { ProductPicker, type ProductDto } from '@/components/products/product-picker';

type Record = Schemas['MealRecordDto'];

/** S-10 ④ 추가 간식 목록 + S-13 입력 시트 (slot=extra, D-10). 진입은 식사 섹션의 '+ 식사 추가' (D-20) */
export function ExtrasPanel({
  date,
  dayHref,
  extras,
  initialOpen = false,
}: {
  date: string;
  /** 이 날의 오늘 화면 경로. 시트를 닫을 때 ?extra=1 을 지우는 데 쓴다 */
  dayHref: string;
  extras: Record[];
  /** '+ 식사 추가 → 추가 간식'(?extra=1) 으로 들어왔을 때 시트를 연다 */
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [open, setOpen] = useState(initialOpen);
  // 같은 페이지 안에서 ?extra=1 로 이동하면 컴포넌트가 유지되므로 prop 변화로 연다
  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);

  function close() {
    setOpen(false);
    if (initialOpen) router.replace(dayHref, { scroll: false });
  }
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<StockUnit>('g');
  const [outside, setOutside] = useState(false);
  const [menu, setMenu] = useState('');
  const [kcal, setKcal] = useState('');

  function reset() {
    setProduct(null);
    setQuantity('');
    setOutside(false);
    setMenu('');
    setKcal('');
  }

  async function save() {
    const body = outside
      ? {
          status: 'eaten',
          kind: 'outside',
          outsideMenu: menu,
          outsideKcal: kcal === '' ? null : Number(kcal),
        }
      : {
          status: 'eaten',
          kind: 'home',
          items: product
            ? [{ productId: product.id, quantity: quantity === '' ? null : Number(quantity), unit }]
            : [],
        };
    try {
      await run(
        () =>
          api('POST', `/meal-records/${date}/extra`, body, { idempotencyKey: newIdempotencyKey() }),
        '추가 간식 저장',
      );
      close();
      reset();
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function remove(id: string) {
    try {
      await run(
        () => api('DELETE', `/meal-records/${date}/extra/${id}`),
        '삭제됨 (남은 양 되돌림)',
      );
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <Section title="추가 간식">
      <StatusBanner status={status} />
      {extras.length === 0 ? (
        <EmptyState>추가 간식 없음. 위 &apos;식사 추가&apos; 에서 넣습니다.</EmptyState>
      ) : (
        extras.map((x) => (
          <Card key={x.id} className="flex items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate">
                {x.kind === 'outside'
                  ? `식단 외 · ${x.outsideMenu ?? ''}`
                  : x.items
                      .map(
                        (i) =>
                          `${i.productName} ${formatQuantity(i.actualQuantity)}${i.displayUnit}`,
                      )
                      .join(', ')}
              </p>
              <p className="text-xs text-muted-foreground">
                {x.nutrition.missing > 0 ? '열량 미상' : `${Math.round(x.nutrition.kcal)} kcal`}
                {x.stockCheckNeeded ? ' · 남은 양 확인 필요' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => x.id && remove(x.id)}
              aria-label="삭제"
              className="rounded-md p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </Card>
        ))
      )}

      <Dialog open={open} onClose={close} title="추가 간식">
        <div className="flex gap-2 text-sm">
          <Button
            variant={outside ? 'outline' : 'default'}
            className="h-8 flex-1 text-xs"
            onClick={() => setOutside(false)}
          >
            내 식품
          </Button>
          <Button
            variant={outside ? 'default' : 'outline'}
            className="h-8 flex-1 text-xs"
            onClick={() => setOutside(true)}
          >
            식단 외 식사
          </Button>
        </div>
        {outside ? (
          <>
            <Field label="메뉴명" htmlFor="extra-menu">
              <Input id="extra-menu" value={menu} onChange={(e) => setMenu(e.target.value)} />
            </Field>
            <Field label="열량 (kcal, 선택)" htmlFor="extra-kcal" hint="비우면 '미상' 으로 남는다">
              <Input
                id="extra-kcal"
                type="number"
                inputMode="decimal"
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
              />
            </Field>
          </>
        ) : product ? (
          <>
            <p className="text-sm">
              {product.name}{' '}
              <button
                type="button"
                className="text-xs text-accent-foreground underline"
                onClick={() => setProduct(null)}
              >
                변경
              </button>
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="수량" htmlFor="extra-qty">
                <Input
                  id="extra-qty"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="단위" htmlFor="extra-unit">
                <Select
                  id="extra-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as StockUnit)}
                >
                  {product.allowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u === 'ea' ? (product.unitLabel ?? '개') : u}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        ) : (
          <ProductPicker
            autoFocus
            onPick={(p) => {
              setProduct(p);
              setUnit(p.stockUnit);
              if (!p.isStockTracked && p.defaultServingAmount !== null)
                setQuantity(String(p.defaultServingAmount));
            }}
          />
        )}
        <Button onClick={save} disabled={outside ? menu.trim() === '' : !product}>
          저장
        </Button>
      </Dialog>
    </Section>
  );
}
