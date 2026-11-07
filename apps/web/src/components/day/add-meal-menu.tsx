'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { SLOT_LABELS, type MealSlot } from '@diet/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * S-10 "+ 식사 추가" (D-20). 오늘 화면에 카드가 없는 끼니(설정에서 숨긴 끼니)와 추가 간식의 진입점.
 * 쓰는 끼니의 자유 끼니는 카드에 '먹었음' 버튼이 있으므로 여기에는 넣지 않는다.
 */
export function AddMealMenu({
  date,
  dayHref,
  hiddenSlots,
}: {
  date: string;
  /** 이 날의 오늘 화면 경로 ('/' 또는 '/day/{date}') */
  dayHref: string;
  /** 설정의 '쓰는 끼니' 에 없고 이 날 기록도 없는 끼니 */
  hiddenSlots: MealSlot[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> 식사 추가
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="식사 추가">
        <Link
          href={`${dayHref}${dayHref.includes('?') ? '&' : '?'}extra=1`}
          onClick={() => setOpen(false)}
          className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border p-3 text-left hover:bg-accent/50"
        >
          <span className="text-sm font-medium">추가 간식</span>
          <span className="text-xs text-muted-foreground">
            끼니 사이에 먹은 것. 같은 날 여러 건 기록할 수 있고 영양 합계에 들어갑니다.
          </span>
        </Link>
        {hiddenSlots.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              설정에서 쓰지 않기로 한 끼니. 오늘만 먹었으면 여기서 기록합니다(기록한 날에만
              보입니다).
            </p>
            {hiddenSlots.map((s) => (
              <Link
                key={s}
                href={`/day/${date}/${s}?action=eat`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-between rounded-lg border border-dashed border-border p-3 text-sm hover:bg-accent/50"
              >
                <span className="font-medium">{SLOT_LABELS[s]}</span>
                <span className="text-xs text-muted-foreground">숨긴 끼니 · 먹었음 기록</span>
              </Link>
            ))}
          </>
        ) : null}
      </Dialog>
    </>
  );
}
