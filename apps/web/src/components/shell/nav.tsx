'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, MoreHorizontal, Package, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LogoutButton } from '@/components/logout-button';

/** screens.md §0: 모바일 하단 탭, PC 사이드바. 통계 탭은 단계 2 에서 추가한다 */
const items = [
  {
    href: '/',
    label: '오늘',
    icon: UtensilsCrossed,
    match: (p: string) => p === '/' || p.startsWith('/day'),
  },
  {
    href: '/plans',
    label: '식단',
    icon: CalendarDays,
    match: (p: string) => p.startsWith('/plans'),
  },
  {
    href: '/products',
    label: '식품',
    icon: Package,
    match: (p: string) =>
      p.startsWith('/products') || p.startsWith('/purchases') || p.startsWith('/stock'),
  },
  {
    href: '/settings',
    label: '더보기',
    icon: MoreHorizontal,
    match: (p: string) => p.startsWith('/settings') || p.startsWith('/weight'),
  },
];

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((it) => {
          const active = it.match(pathname);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[11px]',
                  active ? 'text-accent-foreground' : 'text-muted-foreground',
                )}
              >
                <it.icon className="size-5" />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-5 text-lg font-semibold">식단 관리</div>
      <ul className="flex flex-1 flex-col gap-1 px-3">
        {items.map((it) => {
          const active = it.match(pathname);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent/60',
                )}
              >
                <it.icon className="size-4" />
                {it.label}
              </Link>
              {it.href === '/plans' ? (
                <SubLinks
                  links={[
                    ['/plans', '식단 목록'],
                    ['/plans/weekly', '식단표'],
                    ['/plans/calendar', '캘린더·예외'],
                  ]}
                  pathname={pathname}
                />
              ) : null}
              {it.href === '/products' ? (
                <SubLinks
                  links={[
                    ['/products', '식품 목록'],
                    ['/purchases', '장보기'],
                  ]}
                  pathname={pathname}
                />
              ) : null}
              {it.href === '/settings' ? (
                <SubLinks
                  links={[
                    ['/weight', '체중'],
                    ['/settings/goals', '목표'],
                  ]}
                  pathname={pathname}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="p-3">
        <LogoutButton className="w-full" />
      </div>
    </aside>
  );
}

function SubLinks({ links, pathname }: { links: [string, string][]; pathname: string }) {
  return (
    <ul className="ml-6 mt-0.5 flex flex-col">
      {links.map(([href, label]) => (
        <li key={href}>
          <Link
            href={href}
            className={cn(
              'block rounded-md px-3 py-1 text-xs',
              pathname === href
                ? 'text-sidebar-primary font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
