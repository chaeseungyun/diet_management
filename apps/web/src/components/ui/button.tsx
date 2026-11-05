import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'destructive' | 'ghost';
type Size = 'default' | 'lg';

const variantClass: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline:
    'border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
};

const sizeClass: Record<Size, string> = {
  default: 'h-10 px-4 py-2',
  lg: 'h-12 px-6 text-base',
};

export function buttonClasses(
  variant: Variant = 'default',
  size: Size = 'default',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    variantClass[variant],
    sizeClass[size],
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** 단계 0 최소 버튼. 단계 1에서 shadcn/ui Button으로 교체한다(design-tokens.md §4). */
export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}
