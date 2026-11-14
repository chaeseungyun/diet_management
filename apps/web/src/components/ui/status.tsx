'use client';

import * as React from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError, describeError } from '@/lib/client';
import type { ErrorMessageOptions } from '@/lib/error-messages';

/**
 * G-01 전송 상태 배너: 저장 중 / 저장됨 / 전송 실패(내용 보존) / 충돌(409, 새로 고침).
 * 미전송·실패를 '저장 완료' 로 표시하지 않는다 (NFR-03).
 */
export type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** long: 읽을 내용이 있는 안내(예: 바뀐 떨어질 날)는 더 오래 보인다 */
  | { kind: 'saved'; message?: string; long?: boolean }
  | { kind: 'error'; message: string; conflict?: boolean };

export function useStatus() {
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
  const timer = React.useRef<number | null>(null);

  const set = React.useCallback((s: Status) => {
    if (timer.current) window.clearTimeout(timer.current);
    setStatus(s);
    if (s.kind === 'saved') {
      timer.current = window.setTimeout(() => setStatus({ kind: 'idle' }), s.long ? 8000 : 2500);
    }
  }, []);

  /**
   * 비동기 작업을 감싸 상태를 자동으로 바꾼다. 실패하면 예외를 다시 던진다.
   * errors: 이 화면에서만 다르게 안내할 코드 문구·검증 필드 라벨 (DEC-079)
   */
  const run = React.useCallback(
    async <T,>(
      work: () => Promise<T>,
      savedMessage?: string,
      errors?: ErrorMessageOptions,
    ): Promise<T> => {
      set({ kind: 'saving' });
      try {
        const out = await work();
        set({ kind: 'saved', message: savedMessage });
        return out;
      } catch (e) {
        const message = describeError(e, errors);
        set({
          kind: 'error',
          message,
          // 새로 고침으로 풀리는 충돌만 (WEIGHT_EXISTS 같은 409 확인 요청은 제외)
          conflict:
            e instanceof ApiError && (e.code === 'RECORD_CONFLICT' || e.code === 'CONFLICT'),
        });
        throw e;
      }
    },
    [set],
  );

  return { status, set, run };
}

export function StatusBanner({ status, className }: { status: Status; className?: string }) {
  if (status.kind === 'idle') return null;
  const styles = {
    saving: 'bg-muted text-muted-foreground',
    saved: 'bg-accent text-accent-foreground',
    error: 'bg-destructive text-destructive-foreground',
  } as const;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
        styles[status.kind],
        className,
      )}
    >
      {status.kind === 'saving' ? (
        <>
          <Loader2 className="size-4 animate-spin" /> 저장 중…
        </>
      ) : status.kind === 'saved' ? (
        <>
          <Check className="size-4" /> {status.message ?? '저장됨'}
        </>
      ) : status.conflict ? (
        <>
          <RefreshCw className="size-4" /> {status.message}
        </>
      ) : (
        <>
          <AlertTriangle className="size-4" /> {status.message}
        </>
      )}
    </div>
  );
}
