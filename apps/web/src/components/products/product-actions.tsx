'use client';

import { useRouter } from 'next/navigation';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { StatusBanner, useStatus } from '@/components/ui/status';

/** 보관·복구 (S-32). 활성 식단이 참조하면 API 가 422 로 거부한다 */
export function ProductActions({ product }: { product: Schemas['ProductDto'] }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const archived = product.archivedAt !== null;

  async function toggle() {
    try {
      await run(
        () => api('POST', `/products/${product.id}/${archived ? 'unarchive' : 'archive'}`),
        archived ? '보관 해제' : '보관됨',
      );
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <StatusBanner status={status} />
      <Button variant="ghost" className={archived ? '' : 'text-muted-foreground'} onClick={toggle}>
        {archived ? '보관 해제' : '보관 (목록에서 숨김)'}
      </Button>
    </div>
  );
}
