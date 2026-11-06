'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { displayUnit, formatQuantity } from '@diet/shared';
import { api, newIdempotencyKey } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { ProductPicker, type ProductDto } from '@/components/products/product-picker';

/** S-34: 식품 선택(기존 재구매 우선), 수량(포장 단위), 구매일, 가격·링크, "이미 받았음" */
export function PurchaseForm({ preset, today }: { preset: ProductDto | null; today: string }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [product, setProduct] = useState<ProductDto | null>(preset);
  const [f, setF] = useState({
    quantity: '1',
    purchasedOn: today,
    price: '',
    url: '',
    received: false,
    receivedQuantity: '',
  });
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  const defaultReceive = product ? Number(f.quantity || '0') * product.unitsPerPackage : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setBusy(true);
    try {
      await run(
        () =>
          api(
            'POST',
            '/purchases',
            {
              productId: product.id,
              quantity: Number(f.quantity),
              purchasedOn: f.purchasedOn,
              price: f.price === '' ? null : Number(f.price),
              url: f.url.trim() || null,
              received: f.received,
              ...(f.received && f.receivedQuantity !== ''
                ? { receivedQuantity: Number(f.receivedQuantity) }
                : {}),
            },
            { idempotencyKey: key },
          ),
        f.received ? '구매 기록 (받았음)' : '구매 기록 (배송 중)',
      );
      router.push(f.received ? '/purchases?status=received' : '/purchases');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <StatusBanner status={status} />
      {product ? (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
          <span>
            {product.name}{' '}
            <span className="text-muted-foreground">
              · 포장 1개 = {formatQuantity(product.unitsPerPackage)}
              {displayUnit(product)}
            </span>
          </span>
          <button
            type="button"
            className="text-xs text-accent-foreground underline"
            onClick={() => setProduct(null)}
          >
            변경
          </button>
        </div>
      ) : (
        <ProductPicker autoFocus onPick={setProduct} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="수량 (포장 단위)" htmlFor="qty">
          <Input
            id="qty"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            value={f.quantity}
            onChange={(e) => setF({ ...f, quantity: e.target.value })}
          />
        </Field>
        <Field label="구매일" htmlFor="on">
          <Input
            id="on"
            type="date"
            required
            value={f.purchasedOn}
            onChange={(e) => setF({ ...f, purchasedOn: e.target.value })}
          />
        </Field>
        <Field label="가격 (원, 선택)" htmlFor="price">
          <Input
            id="price"
            type="number"
            inputMode="numeric"
            min="0"
            value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })}
          />
        </Field>
        <Field label="링크 (선택)" htmlFor="url">
          <Input
            id="url"
            type="url"
            value={f.url}
            onChange={(e) => setF({ ...f, url: e.target.value })}
          />
        </Field>
      </div>
      <Checkbox
        label="이미 받았음 (바로 남은 양에 더함)"
        checked={f.received}
        onChange={(e) => setF({ ...f, received: e.target.checked })}
      />
      {f.received && product ? (
        <Field
          label={`받은 양 (${displayUnit(product)})`}
          htmlFor="rq"
          hint={`비우면 ${formatQuantity(defaultReceive)}${displayUnit(product)} (산 개수 × 포장 1개 양)`}
        >
          <Input
            id="rq"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={f.receivedQuantity}
            onChange={(e) => setF({ ...f, receivedQuantity: e.target.value })}
            placeholder={String(defaultReceive)}
          />
        </Field>
      ) : null}
      <Button type="submit" size="lg" disabled={busy || !product}>
        저장
      </Button>
    </form>
  );
}
