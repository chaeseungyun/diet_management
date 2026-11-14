import Link from 'next/link';
import { displayUnit } from '@diet/shared';
import { quantityWithGrams } from '@/lib/format';
import { depletionShort, type StockItem } from '@/lib/stock';
import { Card } from '@/components/ui/card';

/** 오늘 화면 '곧 떨어질 식품' 의 한 줄 (S-10 ⑦). 누르면 식품 상세(S-32) */
export function StockRow({ item }: { item: StockItem }) {
  const unit = displayUnit(item);
  const depletion = depletionShort(item);
  return (
    <Link href={`/products/${item.productId}`}>
      <Card className="flex items-center justify-between gap-2 p-3">
        <p className="min-w-0 truncate font-medium">
          {item.name}
          {item.brand ? (
            <span className="text-sm text-muted-foreground"> · {item.brand}</span>
          ) : null}
        </p>
        <div className="shrink-0 text-right text-sm">
          <span className="font-medium">
            {item.currentStock === null
              ? '–'
              : quantityWithGrams(item.currentStock, item.stockUnit, unit, item.packWeightG)}
          </span>
          {depletion ? (
            <p className="text-xs font-medium text-warning-foreground">{depletion}</p>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}
