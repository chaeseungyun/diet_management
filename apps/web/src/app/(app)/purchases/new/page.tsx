import { redirect } from 'next/navigation';
import { todayIn } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { PurchaseForm } from '@/components/products/purchase-form';

/** 구매 등록 (S-34). ?productId= 로 제품을 미리 고른다 (재구매·S-31 다음 단계) */
export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = await searchParams;
  const me = await getMe();
  if (!me) redirect('/login');
  const preset = productId ? await apiGet<Schemas['ProductDto']>(`/products/${productId}`) : null;
  return (
    <Page title="구매 등록" back="/purchases">
      <PurchaseForm preset={preset} today={todayIn(me.timezone)} />
    </Page>
  );
}
