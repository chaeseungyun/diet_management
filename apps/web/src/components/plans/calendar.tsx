'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  MEAL_SLOTS,
  PLAN_TYPE_LABELS,
  SLOT_LABELS,
  type MealSlot,
  type PlanType,
} from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { addDays, dateLabel, monthLabel, pad2 } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PlanCellDialog, type TemplateRef } from './plan-cell-dialog';

type Summary = Schemas['DaySummaryDto'];
type Resolved = Schemas['ResolvedSlotDto'];

export function Calendar({
  year,
  month,
  rows,
  days,
  today,
  selected,
  resolved,
  templates,
}: {
  year: number;
  month: number;
  rows: (string | null)[][];
  days: Summary[];
  today: string;
  selected: string;
  resolved: Resolved[];
  templates: TemplateRef[];
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [editing, setEditing] = useState<Resolved | null>(null);
  const [batch, setBatch] = useState(false);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad2(month + 1)}`;

  async function saveOverride(
    r: Resolved,
    v: { planType: PlanType; templateId: string | null; note?: string },
  ) {
    try {
      await run(
        () =>
          api('PUT', `/plans/overrides/${r.date}/${r.slot}`, {
            planType: v.planType,
            templateId: v.templateId,
            note: v.note || null,
          }),
        '날짜 예외 저장',
      );
      setEditing(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  async function clearOverride(r: Resolved) {
    try {
      await run(
        () => api('DELETE', `/plans/overrides/${r.date}/${r.slot}`),
        '예외 해제 → 식단표대로',
      );
      setEditing(null);
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[1fr_20rem] md:items-start">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Link
            href={`/plans/calendar?month=${prev}&date=${selected}`}
            aria-label="이전 달"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <h2 className="font-semibold">{monthLabel(year, month)}</h2>
          <Link
            href={`/plans/calendar?month=${next}&date=${selected}`}
            aria-label="다음 달"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>
        <table className="w-full table-fixed text-center text-xs">
          <thead>
            <tr className="text-muted-foreground">
              {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
                <th key={d} className="py-1 font-normal">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((d, j) => {
                  if (!d) return <td key={j} />;
                  const s = byDate.get(d);
                  const isSel = d === selected;
                  return (
                    <td key={d} className="p-0.5">
                      <Link
                        href={`/plans/calendar?month=${year}-${pad2(month)}&date=${d}`}
                        className={cn(
                          'flex h-14 flex-col items-center justify-start gap-0.5 rounded-lg border p-1',
                          isSel ? 'border-ring bg-accent' : 'border-transparent hover:bg-muted',
                          d === today && 'font-semibold',
                        )}
                      >
                        <span>{Number(d.slice(8))}</span>
                        <span className="flex gap-0.5">
                          {s?.completed ? (
                            <i className="size-1.5 rounded-full bg-primary" title="완료" />
                          ) : null}
                          {s?.hasOverride ? (
                            <i
                              className="size-1.5 rounded-full bg-warning-foreground"
                              title="예외"
                            />
                          ) : null}
                          {s?.hasOutside ? (
                            <i
                              className="size-1.5 rounded-full bg-info-foreground"
                              title="식단 외 식사 기록"
                            />
                          ) : null}
                        </span>
                        {s && s.unrecordedCount ? (
                          <span className="text-[10px] text-muted-foreground">
                            미기록 {s.unrecordedCount}
                          </span>
                        ) : null}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground">
          ● 완료(초록) · 예외(주황) · 식단 외 식사 기록(파랑). 완료 표시는 단계 2 에서 켜집니다.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <StatusBanner status={status} />
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{dateLabel(selected)}</h2>
          <Link
            href={selected === today ? '/' : `/day/${selected}`}
            className={buttonClasses('ghost', 'default', 'h-8 px-2 text-xs')}
          >
            기록 보기
          </Link>
        </div>
        {resolved.map((r) => (
          <Card key={r.slot} className="flex items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{SLOT_LABELS[r.slot]}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.planType === 'template'
                  ? (r.templateName ?? '식단')
                  : PLAN_TYPE_LABELS[r.planType]}
                {r.note ? ` · ${r.note}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {r.source === 'override' ? (
                <Badge variant="warning">예외</Badge>
              ) : (
                <Badge variant="outline">식단표</Badge>
              )}
              <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditing(r)}>
                변경
              </Button>
            </div>
          </Card>
        ))}
        <Button variant="outline" onClick={() => setBatch(true)}>
          기간 일괄 변경 (출장)
        </Button>
      </div>

      {editing ? (
        <PlanCellDialog
          key={`${editing.date}-${editing.slot}`}
          open
          title={`${dateLabel(editing.date)} ${SLOT_LABELS[editing.slot]} 예외`}
          initial={{
            planType: editing.planType,
            templateId: editing.templateId,
            note: editing.note ?? '',
          }}
          templates={templates}
          withNote
          onClose={() => setEditing(null)}
          onSave={(v) => saveOverride(editing, v)}
          onClear={editing.source === 'override' ? () => clearOverride(editing) : undefined}
        />
      ) : null}

      <BatchSheet
        open={batch}
        onClose={() => setBatch(false)}
        from={selected}
        templates={templates}
        onDone={() => {
          setBatch(false);
          router.refresh();
        }}
        run={run}
      />
    </div>
  );
}

/** S-24 기간 일괄 변경. 영향 미리보기(예정 소비·소진일)는 소진 예측과 함께 단계 2 */
function BatchSheet({
  open,
  onClose,
  from,
  templates,
  onDone,
  run,
}: {
  open: boolean;
  onClose: () => void;
  from: string;
  templates: TemplateRef[];
  onDone: () => void;
  run: <T>(work: () => Promise<T>, msg?: string) => Promise<T>;
}) {
  const [f, setF] = useState({
    from,
    to: addDays(from, 2),
    planType: 'none' as PlanType,
    templateId: templates[0]?.id ?? '',
    note: '출장',
  });
  const [slots, setSlots] = useState<MealSlot[]>(['breakfast', 'lunch', 'dinner']);

  async function apply() {
    try {
      await run(
        () =>
          api('POST', '/plans/overrides/batch', {
            from: f.from,
            to: f.to,
            slots,
            planType: f.planType,
            templateId: f.planType === 'template' ? f.templateId : null,
            note: f.note || null,
          }),
        '기간 예외 적용',
      );
      onDone();
    } catch {
      // 배너
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="기간 일괄 변경">
      <div className="grid grid-cols-2 gap-2">
        <Field label="시작" htmlFor="b-from">
          <Input
            id="b-from"
            type="date"
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
        </Field>
        <Field label="종료" htmlFor="b-to">
          <Input
            id="b-to"
            type="date"
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">대상 슬롯 (유지할 슬롯은 해제)</legend>
        {MEAL_SLOTS.map((s) => (
          <Checkbox
            key={s}
            label={SLOT_LABELS[s]}
            checked={slots.includes(s)}
            onChange={(e) =>
              setSlots(e.target.checked ? [...slots, s] : slots.filter((x) => x !== s))
            }
          />
        ))}
      </fieldset>
      <Field label="유형" htmlFor="b-type">
        <Select
          id="b-type"
          value={f.planType}
          onChange={(e) => setF({ ...f, planType: e.target.value as PlanType })}
        >
          <option value="none">자유 끼니</option>
          <option value="template">다른 식단</option>
        </Select>
      </Field>
      {f.planType === 'template' ? (
        <Field label="식단" htmlFor="b-template">
          <Select
            id="b-template"
            value={f.templateId}
            onChange={(e) => setF({ ...f, templateId: e.target.value })}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="메모" htmlFor="b-note">
        <Input id="b-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <p className="text-xs text-muted-foreground">
        이미 기록한 식사는 바뀌지 않고 예정 소비만 줄어듭니다. 예정 소비 감소분·떨어질 날 변화
        미리보기는 단계 2 에서 추가됩니다.
      </p>
      <Button
        onClick={apply}
        disabled={
          slots.length === 0 || f.from > f.to || (f.planType === 'template' && !f.templateId)
        }
      >
        적용
      </Button>
    </Dialog>
  );
}
