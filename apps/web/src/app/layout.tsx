import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/settings/theme-script';
import { PwaClient } from '@/components/pwa/pwa-client';

export const metadata: Metadata = {
  title: '끼니로그',
  description: '적은 입력으로 식사·영양·체중을 기록하고 식품이 떨어질 날을 예측한다.',
  applicationName: '끼니로그',
  // 매니페스트는 app/manifest.ts 가 자동으로 연결한다 (DEC-073)
  appleWebApp: { capable: true, title: '끼니로그', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 홈 화면 앱에서 화면 끝까지 쓰고, 홈 바 영역은 env(safe-area-inset-*) 로 비운다
  viewportFit: 'cover',
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
      <body className="min-h-dvh antialiased">
        {children}
        <PwaClient />
      </body>
    </html>
  );
}
