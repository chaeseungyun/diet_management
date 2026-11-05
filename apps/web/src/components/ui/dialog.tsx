'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 모달·바텀 시트. 모바일에서는 아래에서 올라오고 PC 에서는 가운데 뜬다.
 * 네이티브 <dialog> 라 포커스 트랩·ESC 가 기본 제공된다.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-2xl border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/40',
        'md:inset-0 md:m-auto md:max-w-lg md:rounded-2xl',
        'max-h-[90dvh] overflow-y-auto',
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
