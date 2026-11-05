import { Page } from '@/components/shell/page';
import { ProductForm } from '@/components/products/product-form';

/** 제품 등록 (S-31) */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <Page title="제품 등록" back="/products">
      <ProductForm next={next === 'nutrition' || next === 'purchase' ? next : undefined} />
    </Page>
  );
}
