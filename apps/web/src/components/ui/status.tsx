'use client';

import * as React from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/client';

/**
 * G-01 전송 상태 배너: 저장 중 / 저장됨 / 전송 실패(내용 보존) / 충돌(409, 새로 고침).
 * 미전송·실패를 '저장 완료' 로 표시하지 않는다 (NFR-03).
 */
export type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; message?: string }
  | { kind: 'error'; message: string; conflict?: boolean };

export function useStatus() {
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
  const timer = React.useRef<number | null>(null);

  const set = React.useCallback((s: Status) => {
    if (timer.current) window.clearTimeout(timer.current);
    setStatus(s);
    if (s.kind === 'saved') {
      timer.current = window.setTimeout(() => setStatus({ kind: 'idle' }), 2500);
    }
  }, []);

  /** 비동기 작업을 감싸 상태를 자동으로 바꾼다. 실패하면 예외를 다시 던진다 */
  const run = React.useCallback(
    async <T,>(work: () => Promise<T>, savedMessage?: string): Promise<T> => {
      set({ kind: 'saving' });
      try {
        const out = await work();
        set({ kind: 'saved', message: savedMessage });
        return out;
      } catch (e) {
        const message = e instanceof Error ? e.message : '전송에 실패했습니다';
        set({ kind: 'error', message, conflict: e instanceof ApiError && e.status === 409 });
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
