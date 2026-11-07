'use client';

import { MEAL_SLOTS, SLOT_LABELS, type MealSlot } from '@diet/shared';
import { Checkbox } from '@/components/ui/input';

/**
 * 쓰는 끼니 선택 (D-18). 오늘 화면·주간 계획에 보이는 끼니다.
 * 숨긴 끼니도 기록이 있으면 그날은 보이므로 과거 기록은 사라지지 않는다.
 */
export function ActiveSlotsField({
  value,
  onChange,
}: {
  value: MealSlot[];
  onChange: (next: MealSlot[]) => void;
}) {
  const toggle = (slot: MealSlot, on: boolean) => {
    const next = MEAL_SLOTS.filter((s) => (s === slot ? on : value.includes(s)));
    if (next.length === 0) return; // 1개 이상
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">쓰는 끼니</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {MEAL_SLOTS.map((s) => (
          <Checkbox
            key={s}
            label={SLOT_LABELS[s]}
            checked={value.includes(s)}
            disabled={value.length === 1 && value.includes(s)}
            onChange={(e) => toggle(s, e.target.checked)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        고르지 않은 끼니는 오늘 화면과 주간 계획에 보이지 않습니다. 기록이 있는 날에는 보입니다.
      </p>
    </fieldset>
  );
}
