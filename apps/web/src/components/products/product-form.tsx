'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STOCK_UNITS, formatQuantity, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, newIdempotencyKey } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Product = Schemas['ProductDto'];
type ProductDetail = Schemas['ProductDetailDto'];

/** 검증 실패 필드 → 화면 라벨 (DEC-079) */
const FIELD_LABELS = {
  fields: {
    name: '식품명',
    brand: '브랜드',
    stockUnit: '수량 단위',
    unitLabel: '표시 단위명',
    unitsPerPackage: '포장 1개에 들어 있는 양',
    packWeightG: '단위 무게',
    defaultServingAmount: '1회 추정 섭취량',
    purchaseUrl: '구매 링크',
    initialStock: '현재 보유',
    measuredQuantity: '지금 남은 양',
  },
};

/**
 * 식품 등록·수정 (S-31, S-32 수정). 단위 모델은 D-11:
 * 수량 단위(g/ml/개) + 개일 때 표시 단위명 + 포장 1개에 들어 있는 양 + 선택 단위 중량 + 재고 관리 여부.
 * 수정 화면은 '지금 남은 양' 을 함께 받아 실측 잔량 보정을 보낸다(S-42 중 실측 잔량, DEC-078).
 */
export function ProductForm({
  product,
  next,
}: {
  product?: ProductDetail;
  next?: 'nutrition' | 'purchase';
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [f, setF] = useState({
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    stockUnit: (product?.stockUnit ?? 'ea') as StockUnit,
    unitLabel: product?.unitLabel ?? '팩',
    unitsPerPackage: product ? String(product.unitsPerPackage) : '1',
    packWeightG: product?.packWeightG?.toString() ?? '',
    isStockTracked: product?.isStockTracked ?? true,
    defaultServingAmount: product?.defaultServingAmount?.toString() ?? '',
    purchaseUrl: product?.purchaseUrl ?? '',
    initialStock: '',
    withInitial: false,
    // 수정 화면의 '지금 남은 양'. 음수(확인 필요)는 빈칸으로 시작해 새 값을 적게 한다
    stock:
      product?.currentStock != null && product.currentStock >= 0
        ? formatQuantity(product.currentStock)
        : '',
    stockInG: false,
    stockTouched: false,
  });
  const [busy, setBusy] = useState(false);
  const isEa = f.stockUnit === 'ea';
  const unitName = isEa ? f.unitLabel || '개' : f.stockUnit;
  const packWeight = isEa && f.packWeightG !== '' ? Number(f.packWeightG) : 0;
  const canUseG = packWeight > 0;
  const stockInG = f.stockInG && canUseG;
  const locked = product?.stockUnitLocked ?? false;

  /** 남은 양 입력 단위 전환. 적힌 값은 단위 중량으로 바꿔 보여 준다(저장 환산은 서버, D-02) */
  function switchStockUnit(toG: boolean) {
    const n = Number(f.stock);
    const stock =
      f.stock === '' || !Number.isFinite(n) || !canUseG
        ? f.stock
        : formatQuantity(toG ? n * packWeight : n / packWeight);
    setF({ ...f, stockInG: toG, stock });
  }

  /**
   * g 선택이 사라지는 변경(단위 중량 비움·0, 수량 단위 바꿈)에서 g 로 적힌 남은 양이
   * 그대로 다른 단위로 보내지지 않게 한다.
   */
  function changePackWeight(packWeightG: string) {
    const next = Number(packWeightG);
    if (f.stockInG && !(packWeightG !== '' && next > 0)) {
      // g 선택이 사라진다: 직전 단위 중량으로 개 단위로 되돌려 둔다
      const n = Number(f.stock);
      const stock =
        f.stock === '' || !Number.isFinite(n) || !canUseG ? '' : formatQuantity(n / packWeight);
      setF({
        ...f,
        packWeightG,
        stockInG: false,
        stock,
        stockTouched: stock !== '' && f.stockTouched,
      });
      return;
    }
    setF({ ...f, packWeightG });
  }

  function changeStockUnit(stockUnit: StockUnit) {
    if (!f.stockInG) {
      setF({ ...f, stockUnit });
      return;
    }
    // g 로 적던 값: 새 단위가 g 면 그대로 쓰고, 아니면 의미가 없으니 비운다
    setF(
      stockUnit === 'g'
        ? { ...f, stockUnit, stockInG: false }
        : { ...f, stockUnit, stockInG: false, stock: '', stockTouched: false },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: f.name,
      brand: f.brand.trim() || null,
      stockUnit: f.stockUnit,
      unitLabel: isEa ? f.unitLabel : null,
      unitsPerPackage: Number(f.unitsPerPackage || '1'),
      packWeightG: isEa && f.packWeightG !== '' ? Number(f.packWeightG) : null,
      isStockTracked: f.isStockTracked,
      defaultServingAmount: f.defaultServingAmount === '' ? null : Number(f.defaultServingAmount),
      purchaseUrl: f.purchaseUrl.trim() || null,
    };
    try {
      if (product) {
        const adjust = f.isStockTracked && f.stockTouched && f.stock !== '';
        await run(
          async () => {
            await api<Product>('PATCH', `/products/${product.id}`, body);
            // 단위 중량을 같이 바꿨다면 PATCH 뒤라야 g 환산이 새 값을 쓴다
            if (adjust) {
              await api(
                'POST',
                `/stock/${product.id}/adjustments`,
                { measuredQuantity: Number(f.stock), unit: stockInG ? 'g' : f.stockUnit },
                { idempotencyKey: newIdempotencyKey() },
              );
            }
          },
          '식품 수정',
          FIELD_LABELS,
        );
        router.push(`/products/${product.id}`);
      } else {
        const created = await run(
          () =>
            api<Product>('POST', '/products', {
              ...body,
              ...(f.withInitial && f.isStockTracked && f.initialStock !== ''
                ? { initialStock: Number(f.initialStock) }
                : {}),
            }),
          '식품 등록',
          FIELD_LABELS,
        );
        router.push(
          next === 'nutrition'
            ? `/products/${created.id}/nutrition`
            : next === 'purchase'
              ? `/purchases/new?productId=${created.id}`
              : `/products/${created.id}`,
        );
      }
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <StatusBanner status={status} />
      <Field label="식품명" htmlFor="name">
        <Input
          id="name"
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="예: 닭가슴살 100g"
        />
      </Field>
      <Field label="브랜드 (선택)" htmlFor="brand">
        <Input id="brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="수량 단위"
          htmlFor="stockUnit"
          hint={
            locked
              ? `기록이 있어 바꿀 수 없어요${isEa ? `. g 로 적으려면 아래 '1${unitName}의 무게'를 넣으세요` : ''}`
              : '닭가슴살·계란은 개, 프로틴·채소는 g'
          }
        >
          <Select
            id="stockUnit"
            disabled={locked}
            value={f.stockUnit}
            onChange={(e) => changeStockUnit(e.target.value as StockUnit)}
          >
            {STOCK_UNITS.map((u) => (
              <option key={u} value={u}>
                {u === 'ea' ? '개(팩·통 등)' : u}
              </option>
            ))}
          </Select>
        </Field>
        {isEa ? (
          <Field label="표시 단위명" htmlFor="unitLabel" hint="팩·개·통·장">
            <Input
              id="unitLabel"
              required
              value={f.unitLabel}
              onChange={(e) => setF({ ...f, unitLabel: e.target.value })}
            />
          </Field>
        ) : null}
      </div>
      <Field
        label={`포장 1개에 들어 있는 양 (${unitName})`}
        htmlFor="upp"
        hint={`받은 양 기본값 = 구매 수량 × 이 값. 예: 프로틴 1통 = 1000g, 계란 1판 = 30개`}
      >
        <Input
          id="upp"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          required
          value={f.unitsPerPackage}
          onChange={(e) => setF({ ...f, unitsPerPackage: e.target.value })}
        />
      </Field>
      {isEa ? (
        <Field
          label={`1${unitName}의 무게 (g, 선택)`}
          htmlFor="pwg"
          hint="있을 때만 g 입력·개↔g 변환이 켜집니다. 임의 환산은 하지 않습니다 (D-02)"
        >
          <Input
            id="pwg"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.packWeightG}
            onChange={(e) => changePackWeight(e.target.value)}
          />
        </Field>
      ) : null}
      <Checkbox
        label="남은 양을 센다 (소스·양념은 끄기)"
        checked={f.isStockTracked}
        onChange={(e) => setF({ ...f, isStockTracked: e.target.checked })}
      />
      {product && f.isStockTracked ? (
        <Field label="지금 남은 양" htmlFor="stock" hint={stockHint(product, unitName, canUseG)}>
          <div className="flex gap-2">
            <Input
              id="stock"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={f.stock}
              placeholder={
                product.currentStock != null && product.currentStock < 0 ? '실제 남은 양' : ''
              }
              onChange={(e) => setF({ ...f, stock: e.target.value, stockTouched: true })}
            />
            {canUseG ? (
              <Select
                aria-label="남은 양 단위"
                className="w-24 shrink-0"
                value={stockInG ? 'g' : 'stock'}
                onChange={(e) => switchStockUnit(e.target.value === 'g')}
              >
                <option value="stock">{unitName}</option>
                <option value="g">g</option>
              </Select>
            ) : (
              <span className="self-center text-sm text-muted-foreground">{unitName}</span>
            )}
          </div>
        </Field>
      ) : null}
      {!f.isStockTracked ? (
        <Field
          label={`1회 추정 섭취량 (${unitName}, 선택)`}
          htmlFor="dsa"
          hint="남은 양을 세지 않는 식품(소스·양념)을 먹을 때 이 양으로 영양을 추정합니다 (출처: 직접 입력 추정)"
        >
          <Input
            id="dsa"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.defaultServingAmount}
            onChange={(e) => setF({ ...f, defaultServingAmount: e.target.value })}
          />
        </Field>
      ) : null}
      <Field label="구매 링크 (선택)" htmlFor="url">
        <Input
          id="url"
          type="url"
          value={f.purchaseUrl}
          onChange={(e) => setF({ ...f, purchaseUrl: e.target.value })}
          placeholder="https://"
        />
      </Field>
      {!product && f.isStockTracked ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <Checkbox
            label="기존 보유 수량 함께 등록"
            checked={f.withInitial}
            onChange={(e) => setF({ ...f, withInitial: e.target.checked })}
          />
          {f.withInitial ? (
            <Field label={`현재 보유 (${unitName})`} htmlFor="init">
              <Input
                id="init"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={f.initialStock}
                onChange={(e) => setF({ ...f, initialStock: e.target.value })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        영양 정보는 생략할 수 있습니다. 미등록 식품을 쓰는 식단 합계는 '불완전' 으로 표시됩니다.
      </p>
      <Button type="submit" size="lg" disabled={busy}>
        {product
          ? '수정 저장'
          : next === 'nutrition'
            ? '저장 후 영양 입력'
            : next === 'purchase'
              ? '저장 후 구매 기록'
              : '저장'}
      </Button>
    </form>
  );
}

function stockHint(product: ProductDetail, unitName: string, canUseG: boolean): string {
  const now = product.currentStock;
  const recorded =
    now === null
      ? '남은 양 기록이 아직 없습니다.'
      : `기록상 ${formatQuantity(now)}${unitName}${now < 0 ? ' (확인 필요)' : ''}.`;
  return `${recorded} 실제 남은 양을 적으면 차이만큼 맞춥니다.${
    product.stockUnit === 'ea' && !canUseG ? ` g 로 적으려면 '1${unitName}의 무게'를 넣으세요.` : ''
  }`;
}
