import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  NUTRITION_SOURCE_LABELS,
  PURCHASE_STATUS_LABELS,
  displayUnit,
  formatQuantity,
} from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, EmptyState } from '@/components/ui/card';
import { ProductForm } from '@/components/products/product-form';
import { ProductActions } from '@/components/products/product-actions';

const UUID = /^[0-9a-f-]{36}$/i;

/** 식품 상세 (S-32). ?edit=1 이면 수정 폼 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { edit } = await searchParams;
  const p = await apiGet<Schemas['ProductDetailDto']>(`/products/${id}`);
  const unit = displayUnit(p);

  if (edit === '1') {
    return (
      <Page title={`${p.name} 수정`} back={`/products/${p.id}`}>
        <ProductForm product={p} />
      </Page>
    );
  }

  return (
    <Page
      title={p.name}
      back="/products"
      actions={
        <Link
          href={`/products/${p.id}?edit=1`}
          className={buttonClasses('outline', 'default', 'h-8 px-2 text-xs')}
        >
          수정
        </Link>
      }
    >
      <div className="flex flex-wrap gap-1">
        {p.archivedAt ? <Badge variant="secondary">보관됨</Badge> : null}
        {!p.isStockTracked ? <Badge variant="secondary">수량 안 셈</Badge> : null}
        {p.nutrition === null ? <Badge variant="warning">영양 정보 미등록</Badge> : null}
      </div>

      <Card>
        <CardContent className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-4 text-sm">
          <dt className="text-muted-foreground">브랜드</dt>
          <dd>{p.brand ?? '–'}</dd>
          <dt className="text-muted-foreground">수량 단위</dt>
          <dd>
            {unit}
            {p.packWeightG ? ` (1${unit} = ${formatQuantity(p.packWeightG)}g)` : ''}
          </dd>
          <dt className="text-muted-foreground">포장 1개</dt>
          <dd>
            {formatQuantity(p.unitsPerPackage)}
            {unit}
          </dd>
          <dt className="text-muted-foreground">남은 양</dt>
          <dd>
            {p.currentStock === null ? (
              '관리 안 함'
            ) : (
              <>
                {formatQuantity(p.currentStock)}
                {unit}
                {p.packWeightG && p.stockUnit === 'ea'
                  ? ` (${formatQuantity(p.currentStock * p.packWeightG, 1)}g)`
                  : ''}
                {p.currentStock < 0 ? (
                  <Badge variant="warning" className="ml-2">
                    남은 양 확인 필요
                  </Badge>
                ) : null}
                {p.orderedQuantity > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · 배송 중 {formatQuantity(p.orderedQuantity)}
                    {unit}
                  </span>
                ) : null}
              </>
            )}
          </dd>
          {!p.isStockTracked && p.defaultServingAmount !== null ? (
            <>
              <dt className="text-muted-foreground">기본 추정량</dt>
              <dd>
                {formatQuantity(p.defaultServingAmount)}
                {unit}
              </dd>
            </>
          ) : null}
          {p.purchaseUrl ? (
            <>
              <dt className="text-muted-foreground">구매 링크</dt>
              <dd>
                <a
                  href={p.purchaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-foreground underline"
                >
                  열기
                </a>
              </dd>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Section
        title="영양 정보"
        actions={
          <Link href={`/products/${p.id}/nutrition`} className="text-xs text-accent-foreground">
            {p.nutrition ? '수정' : '입력'}
          </Link>
        }
      >
        {p.nutrition ? (
          <Card>
            <CardContent className="pt-4 text-sm">
              <p className="text-xs text-muted-foreground">
                기준 {formatQuantity(p.nutrition.basisAmount)}
                {p.nutrition.basisUnit === 'ea' ? unit : p.nutrition.basisUnit} · 출처{' '}
                {NUTRITION_SOURCE_LABELS[p.nutrition.source]}
              </p>
              <p className="mt-1">
                {p.nutrition.kcal ?? '미상'} kcal · 탄 {p.nutrition.carbG ?? '미상'}g · 단{' '}
                {p.nutrition.proteinG ?? '미상'}g · 지 {p.nutrition.fatG ?? '미상'}g
              </p>
            </CardContent>
          </Card>
        ) : (
          <EmptyState>
            영양 정보 미등록. 이 식품을 쓰는 식단 합계는 불완전으로 표시됩니다.
          </EmptyState>
        )}
      </Section>

      <Section
        title="구매 기록"
        actions={
          <Link
            href={`/purchases/new?productId=${p.id}`}
            className="text-xs text-accent-foreground"
          >
            구매 기록
          </Link>
        }
      >
        {p.purchases.length === 0 ? (
          <EmptyState>구매 기록 없음</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {p.purchases.map((x) => (
              <li
                key={x.id}
                className="flex justify-between rounded-lg border border-border px-3 py-2"
              >
                <span>
                  {x.purchasedOn} · {formatQuantity(x.quantity)}개 포장
                  {x.price !== null ? ` · ${x.price.toLocaleString()}원` : ''}
                </span>
                <span className="text-muted-foreground">
                  {PURCHASE_STATUS_LABELS[x.status]}
                  {x.receivedQuantity !== null
                    ? ` ${formatQuantity(x.receivedQuantity)}${unit}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="사용 중인 템플릿">
        {p.templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {p.templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/plans/templates/${t.id}`}
                  className={buttonClasses('outline', 'default', 'h-7 px-2 text-xs')}
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ProductActions product={p} />
    </Page>
  );
}
