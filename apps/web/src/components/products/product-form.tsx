'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STOCK_UNITS, type StockUnit } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Product = Schemas['ProductDto'];

/**
 * 식품 등록·수정 (S-31, S-32 수정). 단위 모델은 D-11:
 * 수량 단위(g/ml/개) + 개일 때 표시 단위명 + 포장 1개에 들어 있는 양 + 선택 단위 중량 + 재고 관리 여부.
 */
export function ProductForm({
  product,
  next,
}: {
  product?: Product;
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
  });
  const [busy, setBusy] = useState(false);
  const isEa = f.stockUnit === 'ea';
  const unitName = isEa ? f.unitLabel || '개' : f.stockUnit;

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
        await run(() => api<Product>('PATCH', `/products/${product.id}`, body), '식품 수정');
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
            product
              ? '원장 이동이 생긴 뒤에는 바꿀 수 없음 (D-13)'
              : '닭가슴살·계란은 개, 프로틴·채소는 g'
          }
        >
          <Select
            id="stockUnit"
            value={f.stockUnit}
            onChange={(e) => setF({ ...f, stockUnit: e.target.value as StockUnit })}
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
            onChange={(e) => setF({ ...f, packWeightG: e.target.value })}
          />
        </Field>
      ) : null}
      <Checkbox
        label="남은 양을 센다 (소스·양념은 끄기)"
        checked={f.isStockTracked}
        onChange={(e) => setF({ ...f, isStockTracked: e.target.checked })}
      />
      {!f.isStockTracked ? (
        <Field
          label={`기본 추정 섭취량 (${unitName}, 선택)`}
          htmlFor="dsa"
          hint="매번 계량하지 않고 이 값으로 영양을 추정합니다 (출처: 직접 입력 추정)"
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
