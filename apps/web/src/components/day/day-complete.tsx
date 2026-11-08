'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, CheckCircle2, Circle, Minus } from 'lucide-react';
import { SLOT_LABELS } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';

type Check = Schemas['DayCompletionCheckDto'];
type Completion = Schemas['DayCompletionDto'];

/**
 * S-10 ⑧ 하루 완료 + S-14 확인 다이얼로그 (FR-06, D-04, D-18, D-19, D-20).
 * 완료는 "쓰는 끼니 중 식단 끼니에 미기록 없음" 이고 목표 달성과는 별개다.
 * 미기록 자유 끼니는 막지 않되 한 번 묻는다: 아니오 = 안 먹음으로 저장, 기록 = S-11 로.
 */
export function DayComplete({
  date,
  check,
  completion,
}: {
  date: string;
  check: Check;
  completion: Completion | null;
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function complete(skipUnrecordedFree: boolean) {
    setBusy(true);
    try {
      await run(
        () => api('PUT', `/days/${date}/completion`, { skipUnrecordedFree }),
        check.nutritionComplete ? '하루 완료' : '하루 완료 (영양 일부 미확인)',
      );
      setOpen(false);
      router.refresh();
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  async function uncomplete() {
    setBusy(true);
    try {
      await run(() => api('DELETE', `/days/${date}/completion`), '완료 해제');
      router.refresh();
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  if (completion) {
    return (
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">
            <CheckCircle2 className="size-3.5" /> 기록 완료
          </Badge>
          {completion.nutritionComplete ? (
            <Badge variant="outline">영양 모두 확인됨</Badge>
          ) : (
            <Badge variant="warning">영양 일부 미확인</Badge>
          )}
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            {timeLabel(completion.completedAt)}
          </span>
          <Button
            variant="outline"
            className="ml-auto h-8 px-3 text-xs"
            onClick={uncomplete}
            disabled={busy}
          >
            완료 해제
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {completion.nutritionComplete
            ? '이 날은 통계의 유효일에 들어갑니다.'
            : '영양 미확인 항목이 있어 주간·월간 평균에서는 빠지고 기록 완료율에만 들어갑니다. 영양을 보완하고 다시 완료하면 바뀝니다.'}{' '}
          기록을 수정하면 완료가 자동으로 해제됩니다.
        </p>
        <StatusBanner status={status} />
      </Card>
    );
  }

  if (check.blocker === 'future') {
    return <p className="text-sm text-muted-foreground">아직 오지 않은 날은 완료할 수 없습니다.</p>;
  }
  if (check.blocker === 'before_signup') {
    return (
      <p className="text-sm text-muted-foreground">가입 전 날짜는 집계하지 않아 완료가 없습니다.</p>
    );
  }

  const blocked = check.blocker === 'unrecorded';
  return (
    <Card className="flex flex-col gap-2 p-3">
      <Button size="lg" className="w-full" disabled={blocked || busy} onClick={() => setOpen(true)}>
        <Check className="size-5" /> 하루 완료
      </Button>
      {blocked ? (
        <p className="text-xs text-muted-foreground">
          식단 끼니에 미기록이 있습니다:{' '}
          {check.unrecorded.map((s, i) => (
            <span key={s}>
              {i > 0 ? ', ' : ''}
              <Link href={`/day/${date}/${s}`} className="text-accent-foreground underline">
                {SLOT_LABELS[s]}
              </Link>
            </span>
          ))}
          . 먹었음이나 안 먹음으로 기록하면 완료할 수 있습니다.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          식단 끼니가 모두 기록됐습니다. 완료는 목표 달성과 별개로 &apos;기록을 마쳤다&apos; 는
          표시입니다.
        </p>
      )}
      <StatusBanner status={status} />

      <Dialog open={open} onClose={() => setOpen(false)} title="하루 완료">
        <ul className="flex flex-col gap-1.5">
          {check.slots.map((s) => (
            <li key={s.slot} className="flex items-center gap-2 text-sm">
              <SlotStatusIcon status={s.status} />
              <span className="font-medium">{SLOT_LABELS[s.slot]}</span>
              <span className="text-muted-foreground">
                {s.status === 'eaten' ? '먹었음' : s.status === 'skipped' ? '안 먹음' : '미기록'}
              </span>
              {s.planType === 'none' ? (
                <Badge variant="secondary" className="ml-auto">
                  자유 끼니{!s.counted ? ' · 집계 제외' : ''}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>

        {check.unrecordedFree.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">
              {check.unrecordedFree.map((s) => SLOT_LABELS[s]).join(' · ')}에 뭔가 드셨나요?
            </p>
            <p className="text-xs text-muted-foreground">
              &apos;아니오&apos; 는 안 먹음으로 저장하고 완료합니다. 먹었다면 먼저 기록해 주세요.
              미기록으로 두면 그 끼니만 집계에서 빠집니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={busy} onClick={() => complete(true)}>
                아니오, 안 먹었어요
              </Button>
              <Link
                href={`/day/${date}/${check.unrecordedFree[0]}?action=eat`}
                className={buttonClasses('default')}
                onClick={() => setOpen(false)}
              >
                기록하기
              </Link>
            </div>
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline"
              disabled={busy}
              onClick={() => complete(false)}
            >
              미기록으로 두고 완료
            </button>
          </div>
        ) : (
          <Button size="lg" className="w-full" disabled={busy} onClick={() => complete(false)}>
            완료
          </Button>
        )}

        {!check.nutritionComplete ? (
          <p className="rounded-lg bg-warning px-3 py-2 text-xs text-warning-foreground">
            영양 미확인 {check.missing}건이 있어 &apos;기록 완료 · 영양 일부 미확인&apos; 으로
            저장됩니다. 기록 완료율에는 들어가지만 주간·월간 영양 평균에서는 빠집니다.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          완료는 기록을 마쳤다는 표시이며 목표 달성과는 별개입니다. 뒤에 기록을 수정하면 자동으로
          해제됩니다.
        </p>
        <StatusBanner status={status} />
      </Dialog>
    </Card>
  );
}

function SlotStatusIcon({ status }: { status: Check['slots'][number]['status'] }) {
  if (status === 'eaten') return <Check className="size-4 text-accent-foreground" />;
  if (status === 'skipped') return <Minus className="size-4 text-muted-foreground" />;
  return <Circle className={cn('size-4 text-muted-foreground')} />;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 완료';
}
