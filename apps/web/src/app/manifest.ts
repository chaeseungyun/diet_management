import type { MetadataRoute } from 'next';

/**
 * 웹 앱 매니페스트 (/manifest.webmanifest, DEC-073). 로그인 없이 읽혀야 하므로 (app) 밖에 둔다.
 * display=standalone 이어야 아이폰 홈 화면 앱에서 웹 푸시가 열린다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '끼니로그',
    short_name: '끼니로그',
    description: '적은 입력으로 식사·영양·체중을 기록하고 식품이 떨어질 날을 예측한다.',
    lang: 'ko',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf8f2',
    theme_color: '#faf8f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
