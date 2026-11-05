'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'theme';

/** globals.css 의 .dark 변형을 쓴다. 선택은 이 기기에만 저장 (localStorage) */
export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY) as Theme | null;
      if (saved) setTheme(saved);
    } catch {
      // 저장소 접근 불가
    }
  }, []);
  function pick(t: Theme) {
    setTheme(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      // 무시
    }
    applyTheme(t);
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {(['system', 'light', 'dark'] as const).map((t) => (
        <Button
          key={t}
          variant={theme === t ? 'default' : 'outline'}
          className="h-9 text-xs"
          onClick={() => pick(t)}
        >
          {{ system: '시스템', light: '라이트', dark: '다크' }[t]}
        </Button>
      ))}
    </div>
  );
}
