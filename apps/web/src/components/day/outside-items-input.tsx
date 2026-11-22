'use client';

import { Plus, Trash2 } from 'lucide-react';
import { NAME_MAX_LENGTH, OUTSIDE_ITEMS_MAX, OUTSIDE_NUTRITION_MAX } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const FIELDS = [
  ['kcal', 'kcal'],
  ['carbG', '탄(g)'],
  ['proteinG', '단(g)'],
  ['fatG', '지(g)'],
] as const;
type NutritionKey = (typeof FIELDS)[number][0];

/** 식단 외 식사의 메뉴 한 줄 초안 (DEC-103). 빈 칸은 미상(null), 0 은 확인된 0 */
export type OutsideLine = { key: string; name: string } & { [K in NutritionKey]: string };

let seq = 0;
export function emptyOutsideLine(): OutsideLine {
  seq += 1;
  return { key: `line-${seq}`, name: '', kcal: '', carbG: '', proteinG: '', fatG: '' };
}

/** 저장된 줄에서 초안을 만든다. 줄이 없으면 빈 줄 하나로 시작한다 */
export function outsideLinesFrom(items: Schemas['OutsideItemDto'][]): OutsideLine[] {
  if (items.length === 0) return [emptyOutsideLine()];
  return items.map((i) => ({
    key: i.id,
    name: i.name,
    kcal: i.nutrition.kcal?.toString() ?? '',
    carbG: i.nutrition.carbG?.toString() ?? '',
    proteinG: i.nutrition.proteinG?.toString() ?? '',
    fatG: i.nutrition.fatG?.toString() ?? '',
  }));
}

const isBlank = (l: OutsideLine) =>
  l.name.trim() === '' && FIELDS.every(([k]) => l[k].trim() === '');

/** 아무것도 적지 않은 줄은 보내지 않는다 */
const filled = (lines: OutsideLine[]) => lines.filter((l) => !isBlank(l));

/** 서버 검증과 같은 규칙: 0 이상 상한 이하, 소수 셋째 자리까지. 빈 칸은 미상이라 통과 */
function validNumber(s: string): boolean {
  if (s.trim() === '') return true;
  const n = Number(s);
  return (
    Number.isFinite(n) &&
    n >= 0 &&
    n <= OUTSIDE_NUTRITION_MAX &&
    Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6
  );
}

/** 한 글자라도 적었는가(안내 문구를 처음부터 띄우지 않기 위해) */
export function outsideLinesTouched(lines: OutsideLine[]): boolean {
  return filled(lines).length > 0;
}

/** 저장할 수 없는 이유. 저장할 수 있으면 null */
export function outsideLinesProblem(lines: OutsideLine[]): string | null {
  if (filled(lines).length === 0)
    return '식단 외 식사는 메뉴 이름을 하나 이상 입력해야 저장됩니다.';
  for (const [idx, l] of lines.entries()) {
    if (isBlank(l)) continue;
    if (l.name.trim() === '') return `메뉴 ${idx + 1}의 이름을 입력해 주세요.`;
    if (!FIELDS.every(([k]) => validNumber(l[k]))) {
      return `메뉴 ${idx + 1}의 영양 값을 확인해 주세요. 0 이상 ${OUTSIDE_NUTRITION_MAX.toLocaleString('ko-KR')} 이하, 소수 셋째 자리까지 적을 수 있습니다.`;
    }
  }
  return null;
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** 요청 본문의 outsideItems */
export function outsideLinesBody(lines: OutsideLine[]) {
  return filled(lines).map((l) => ({
    name: l.name.trim(),
    kcal: num(l.kcal),
    carbG: num(l.carbG),
    proteinG: num(l.proteinG),
    fatG: num(l.fatG),
  }));
}

/** 변경 여부 판정용 값 */
export function outsideLinesKey(lines: OutsideLine[]) {
  return filled(lines).map((l) => [l.name.trim(), ...FIELDS.map(([k]) => l[k].trim())]);
}

/** 메뉴 여러 줄 입력: 줄마다 이름 + 열량·탄단지(선택). 수량 칸은 없다 (DEC-103) */
export function OutsideItemsInput({
  lines,
  onChange,
  idPrefix,
}: {
  lines: OutsideLine[];
  onChange: (lines: OutsideLine[]) => void;
  idPrefix: string;
}) {
  const set = (key: string, patch: Partial<OutsideLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, idx) => (
        <div key={l.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label={`메뉴 ${idx + 1}`} htmlFor={`${idPrefix}-name-${idx}`}>
                <Input
                  id={`${idPrefix}-name-${idx}`}
                  value={l.name}
                  maxLength={NAME_MAX_LENGTH}
                  onChange={(e) => set(l.key, { name: e.target.value })}
                  placeholder={idx === 0 ? '예: 김치찌개 1인분' : undefined}
                />
              </Field>
            </div>
            {lines.length > 1 ? (
              <button
                type="button"
                aria-label={`메뉴 ${idx + 1} 삭제`}
                className="mb-1 rounded-md p-2 text-muted-foreground hover:text-foreground"
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`${idPrefix}-${k}-${idx}`}>
                <Input
                  id={`${idPrefix}-${k}-${idx}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  value={l[k]}
                  onChange={(e) => set(l.key, { [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </div>
      ))}
      {lines.length < OUTSIDE_ITEMS_MAX ? (
        <Button
          variant="ghost"
          className="h-8 self-start px-2 text-xs"
          onClick={() => onChange([...lines, emptyOutsideLine()])}
        >
          <Plus className="size-4" /> 메뉴 추가
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        영양은 직접 입력합니다. 비운 칸은 &apos;미확인&apos; 으로 남고 메뉴 이름으로 자동 계산하지
        않습니다.
      </p>
    </div>
  );
}
