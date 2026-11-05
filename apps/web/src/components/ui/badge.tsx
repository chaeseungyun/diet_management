import * as React from 'react';
import { cn } from '@/lib/utils';

/** design-tokens.md §4: shadcn Badge + success/warning/info variant. 상태는 색만으로 표시하지 않는다(NFR-01) */
export type BadgeVariant =
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'info' | 'destructive';

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground border-transparent',
  secondary: 'bg-secondary text-secondary-foreground border-transparent',
  outline: 'border-border text-muted-foreground',
  success: 'bg-accent text-accent-foreground border-transparent',
  warning: 'bg-warning text-warning-foreground border-transparent',
  info: 'bg-info text-info-foreground border-transparent',
  destructive: 'bg-destructive text-destructive-foreground border-transparent',
};

export function Badge({
  variant = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
