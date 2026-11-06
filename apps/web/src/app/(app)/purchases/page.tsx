import Link from 'next/link';
import { PURCHASE_STATUSES, type PurchaseStatus } from '@diet/shared';
import { apiGet, type Schemas } from '@/lib/api';
import { Page } from '@/components/shell/page';
import { buttonClasses } from '@/components/ui/button';
import { PurchaseList } from '@/components/products/purchase-list';

/** 구매 목록 (S-35): 배송 중 / 받았음 / 취소 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const current: PurchaseStatus = (PURCHASE_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as PurchaseStatus)
    : 'ordered';
  const purchases = await apiGet<Schemas['PurchaseDto'][]>(`/purchases?status=${current}`);

  return (
    <Page
      title="장보기"
      back="/products"
      actions={
        <Link
          href="/purchases/new"
          className={buttonClasses('default', 'default', 'h-8 px-3 text-xs')}
        >
          구매 기록
        </Link>
      }
    >
      <PurchaseList purchases={purchases} status={current} />
    </Page>
  );
}
