import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 화면 공통 틀: 제목, 뒤로 링크, 우측 동작 */
export function Page({
  title,
  back,
  actions,
  children,
  wide = false,
}: {
  title: React.ReactNode;
  back?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className={cn(
        // 하단 탭 높이 + 홈 바 영역(safe area, DEC-073)
        'mx-auto flex w-full flex-col gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:pb-8',
        wide ? 'max-w-4xl' : 'max-w-md md:max-w-2xl',
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {back ? (
            <Link
              href={back}
              aria-label="뒤로"
              className="-ml-2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-5" />
            </Link>
          ) : null}
          <h1 className="truncate text-xl font-semibold">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

export function Section({
  title,
  children,
  className,
  actions,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title ? (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
