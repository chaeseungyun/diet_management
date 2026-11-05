import { notFound } from 'next/navigation';
import { NUTRITION_SOURCE_LABELS, displayUnit, formatQuantity } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { NutritionForm } from '@/components/products/nutrition-form';

const UUID = /^[0-9a-f-]{36}$/i;

/** 영양 정보 입력·수정 (S-33) + 이력 */
export default async function NutritionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [product, versions] = await Promise.all([
    apiGet<Schemas['ProductDetailDto']>(`/products/${id}`),
    apiGet<Schemas['NutritionVersionDto'][]>(`/products/${id}/nutrition`),
  ]);
  const unit = displayUnit(product);

  return (
    <Page title={`${product.name} 영양`} back={`/products/${product.id}`}>
      <NutritionForm product={product} />
      {versions.length > 0 ? (
        <Section title="이력 (과거 기록은 바뀌지 않음)">
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {versions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border px-3 py-2">
                {v.supersededAt ? '이전' : '현재'} · 기준 {formatQuantity(v.basisAmount)}
                {v.basisUnit === 'ea' ? unit : v.basisUnit} · {v.kcal ?? '미상'} kcal · 탄{' '}
                {v.carbG ?? '–'} 단 {v.proteinG ?? '–'} 지 {v.fatG ?? '–'} ·{' '}
                {NUTRITION_SOURCE_LABELS[v.source]} · {v.createdAt.slice(0, 10)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}
