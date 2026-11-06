import Link from 'next/link';
import { displayUnit, formatQuantity } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState } from '@/components/ui/card';
import { ProductSearch } from '@/components/products/product-search';

/** 식품 목록 (S-30). 재고 현황 화면(S-40)은 단계 2 이므로 여기서 남은 양을 같이 보여 준다 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { q = '', archived } = await searchParams;
  const showArchived = archived === 'true';
  const products = await apiGet<Schemas['ProductDto'][]>(
    `/products?q=${encodeURIComponent(q)}${showArchived ? '&archived=true' : ''}`,
  );

  return (
    <Page
      title="식품"
      actions={
        <>
          <Link
            href="/purchases"
            className={buttonClasses('outline', 'default', 'h-8 px-2 text-xs')}
          >
            장보기
          </Link>
          <Link
            href="/products/new"
            className={buttonClasses('default', 'default', 'h-8 px-3 text-xs')}
          >
            새 식품
          </Link>
        </>
      }
    >
      <ProductSearch q={q} archived={showArchived} />
      {products.length === 0 ? (
        <EmptyState>
          {q
            ? '검색 결과 없음'
            : showArchived
              ? '보관된 식품 없음'
              : '등록된 식품이 없습니다. 이름과 포장 규격만으로 먼저 등록할 수 있습니다.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.id}`}>
                <Card className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {p.name}
                      {p.brand ? (
                        <span className="text-sm text-muted-foreground"> · {p.brand}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      포장 1개 = {formatQuantity(p.unitsPerPackage)}
                      {displayUnit(p)}
                      {p.packWeightG
                        ? ` · 1${displayUnit(p)} = ${formatQuantity(p.packWeightG)}g`
                        : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.nutrition === null ? <Badge variant="warning">영양 미등록</Badge> : null}
                      {!p.isStockTracked ? <Badge variant="secondary">수량 안 셈</Badge> : null}
                      {p.currentStock !== null && p.currentStock < 0 ? (
                        <Badge variant="warning">남은 양 확인 필요</Badge>
                      ) : null}
                      {p.currentStock === 0 ? <Badge variant="destructive">다 먹음</Badge> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {p.currentStock === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <>
                        <span className="font-medium">{formatQuantity(p.currentStock)}</span>
                        <span className="text-muted-foreground">{displayUnit(p)}</span>
                      </>
                    )}
                    {p.orderedQuantity > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        배송 중 {formatQuantity(p.orderedQuantity)}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
