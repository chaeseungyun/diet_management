'use client';

import { useState } from 'react';
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanType } from '@diet/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';

export interface TemplateRef {
  id: string;
  name: string;
}

export interface PlanCellValue {
  planType: PlanType;
  templateId: string | null;
  note?: string;
}

/** 셀 유형·템플릿 선택 시트 (S-22 셀 탭, S-23 슬롯 예외) */
export function PlanCellDialog({
  open,
  title,
  initial,
  templates,
  withNote = false,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  title: string;
  initial: PlanCellValue;
  templates: TemplateRef[];
  withNote?: boolean;
  onClose: () => void;
  onSave: (v: PlanCellValue) => void;
  onClear?: () => void;
}) {
  const [planType, setPlanType] = useState<PlanType>(initial.planType);
  const [templateId, setTemplateId] = useState<string>(
    initial.templateId ?? templates[0]?.id ?? '',
  );
  const [note, setNote] = useState(initial.note ?? '');

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="grid grid-cols-3 gap-2">
        {PLAN_TYPES.map((t) => (
          <Button
            key={t}
            variant={planType === t ? 'default' : 'outline'}
            className="h-9 text-xs"
            onClick={() => setPlanType(t)}
          >
            {PLAN_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>
      {planType === 'template' ? (
        <Field
          label="템플릿"
          htmlFor="pc-template"
          hint={templates.length === 0 ? '먼저 템플릿을 만드세요' : undefined}
        >
          <Select
            id="pc-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {withNote ? (
        <Field label="메모 (선택)" htmlFor="pc-note">
          <Input
            id="pc-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 출장"
          />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {onClear ? (
          <Button variant="outline" onClick={onClear}>
            예외 해제
          </Button>
        ) : (
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        )}
        <Button
          disabled={planType === 'template' && !templateId}
          onClick={() =>
            onSave({ planType, templateId: planType === 'template' ? templateId : null, note })
          }
        >
          저장
        </Button>
      </div>
    </Dialog>
  );
}
