'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input, Checkbox } from '@/components/ui/input';

export function ProductSearch({ q, archived }: { q: string; archived: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  function go(nextQ: string, nextArchived: boolean) {
    const params = new URLSearchParams();
    if (nextQ) params.set('q', nextQ);
    if (nextArchived) params.set('archived', 'true');
    router.replace(`/products${params.size ? `?${params}` : ''}`);
  }
  return (
    <form
      className="flex items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        go(value, archived);
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="식품명·브랜드 검색"
        aria-label="검색"
      />
      <Checkbox
        label="보관"
        checked={archived}
        onChange={(e) => go(value, e.target.checked)}
        className="shrink-0"
      />
    </form>
  );
}
