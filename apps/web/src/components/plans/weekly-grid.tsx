'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MEAL_SLOTS,
  PLAN_TYPE_LABELS,
  SLOT_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type MealSlot,
  type Weekday,
} from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { PlanCellDialog, type TemplateRef } from './plan-cell-dialog';

type Grid = Schemas['WeeklyGridDto'];
type Cell = Schemas['WeeklyCellDto'];

/** S-22: 요일 7 × 슬롯 5. 모바일은 요일별 세로 목록, PC 는 격자. 요일 복사는 격자 전체 교체 API */
export function WeeklyGrid({ grid, templates }: { grid: Grid; templates: TemplateRef[] }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [editing, setEditing] = useState<Cell | null>(null);
  const [copy, setCopy] = useState<{ from: Weekday; to: Weekday } | null>(null);

  const cell = (w: number, s: MealSlot): Cell =>
    grid.cells.find((c) => c.weekday === w && c.slot === s) ?? {
      weekday: w,
      slot: s,
      planType: 'none',
      templateId: null,
      templateName: null,
    };

  async function saveCell(c: Cell, v: { planType: Cell['planType']; templateId: string | null }) {
    try {
      await run(() => api('PUT', `/plans/weekly/${c.weekday}/${c.slot}`, v), '계획 저장');
      setEditing(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function copyWeekday() {
    if (!copy) return;
    const cells = grid.cells
      .filter((c) => c.weekday !== copy.to)
      .concat(MEAL_SLOTS.map((s) => ({ ...cell(copy.from, s), weekday: copy.to })))
      .filter((c) => c.planType !== 'none')
      .map((c) => ({
        weekday: c.weekday,
        slot: c.slot,
        planType: c.planType,
        templateId: c.templateId,
      }));
    try {
      await run(
        () => api('PUT', '/plans/weekly', { cells }),
        `${WEEKDAY_LABELS[copy.from]}요일 → ${WEEKDAY_LABELS[copy.to]}요일 복사`,
      );
      setCopy(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  const CellButton = ({ c }: { c: Cell }) => (
    <button
      type="button"
      onClick={() => setEditing(c)}
      className={cn(
        'flex min-h-12 w-full flex-col items-start justify-center rounded-lg border px-2 py-1 text-left text-xs',
        c.planType === 'template'
          ? 'border-border bg-card'
          : c.planType === 'outside'
            ? 'border-transparent bg-info text-info-foreground'
            : 'border-dashed border-border bg-secondary text-secondary-foreground',
      )}
    >
      <span className="font-medium">
        {c.planType === 'template' ? (c.templateName ?? '템플릿') : PLAN_TYPE_LABELS[c.planType]}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <StatusBanner status={status} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          셀을 눌러 고정 식단 / 외부 식사 / 계획 없음을 정합니다. 날짜 예외가 이 계획보다
          우선합니다.
        </p>
        <Button
          variant="outline"
          className="h-8 shrink-0 px-2 text-xs"
          onClick={() => setCopy({ from: 1, to: 2 })}
        >
          요일 복사
        </Button>
      </div>

      {/* 모바일: 요일별 세로 목록 */}
      <div className="flex flex-col gap-3 md:hidden">
        {WEEKDAYS.map((w) => (
          <section key={w} className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">{WEEKDAY_LABELS[w]}요일</h2>
            {MEAL_SLOTS.map((s) => (
              <div key={s} className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <span className="text-xs text-muted-foreground">{SLOT_LABELS[s]}</span>
                <CellButton c={cell(w, s)} />
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* PC: 격자 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-20" />
              {WEEKDAYS.map((w) => (
                <th key={w} className="font-medium">
                  {WEEKDAY_LABELS[w]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEAL_SLOTS.map((s) => (
              <tr key={s}>
                <th className="text-left font-medium text-muted-foreground">{SLOT_LABELS[s]}</th>
                {WEEKDAYS.map((w) => (
                  <td key={w}>
                    <CellButton c={cell(w, s)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <PlanCellDialog
          key={`${editing.weekday}-${editing.slot}`}
          open
          title={`${WEEKDAY_LABELS[editing.weekday as Weekday]}요일 ${SLOT_LABELS[editing.slot]}`}
          initial={{ planType: editing.planType, templateId: editing.templateId }}
          templates={templates}
          onClose={() => setEditing(null)}
          onSave={(v) => saveCell(editing, v)}
        />
      ) : null}

      <Dialog open={copy !== null} onClose={() => setCopy(null)} title="요일 복사">
        {copy ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="원본" htmlFor="cp-from">
                <Select
                  id="cp-from"
                  value={copy.from}
                  onChange={(e) => setCopy({ ...copy, from: Number(e.target.value) as Weekday })}
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w} value={w}>
                      {WEEKDAY_LABELS[w]}요일
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="대상" htmlFor="cp-to">
                <Select
                  id="cp-to"
                  value={copy.to}
                  onChange={(e) => setCopy({ ...copy, to: Number(e.target.value) as Weekday })}
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w} value={w}>
                      {WEEKDAY_LABELS[w]}요일
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              대상 요일의 5개 슬롯을 원본과 같게 바꿉니다.
            </p>
            <Button onClick={copyWeekday} disabled={copy.from === copy.to}>
              복사
            </Button>
          </>
        ) : null}
      </Dialog>
      <p className="text-xs text-muted-foreground">
        <Badge variant="info">외부 식사</Badge> 는 재고를 차감하지 않고,{' '}
        <Badge variant="secondary">계획 없음</Badge> 은 알림·완료 판정에서 제외됩니다(제안).
      </p>
    </div>
  );
}
