import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/settings/theme-script';

export const metadata: Metadata = {
  title: '식단 관리',
  description: '적은 입력으로 식사·영양·체중을 기록하고 식품이 떨어질 날을 예측한다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F2' },
    { media: '(prefers-color-scheme: dark)', color: '#171612' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
