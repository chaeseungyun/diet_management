// PWA 아이콘 PNG 생성 (DEC-073). 원본은 이 파일의 SVG 이고, 결과 PNG 를 public/icons 에 커밋한다.
// sharp 는 next 의 선택 의존성이라 next 기준으로 찾는다(웹에 직접 의존성을 늘리지 않음).
// 실행: pnpm --filter @diet/web icons
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require(
  require.resolve('sharp', { paths: [dirname(require.resolve('next/package.json'))] }),
);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// 토큰: --primary #3fbf7f, --accent-foreground #14633f (globals.css)
// 그릇(진초록) + 밥(흰색) + 체크 = '끼니를 기록했다'
const art = `
  <path d="M146 232 C160 160 352 160 366 232 Z" fill="#ffffff"/>
  <path d="M120 232 H392 A136 136 0 0 1 120 232 Z" fill="#14633f"/>
  <rect x="204" y="362" width="104" height="22" rx="8" fill="#14633f"/>
  <polyline points="210,280 244,314 304,254" fill="none" stroke="#ffffff" stroke-width="24"
    stroke-linecap="round" stroke-linejoin="round"/>`;

// any: 둥근 사각형(투명 모서리). maskable·apple: 꽉 찬 사각형(런처·iOS 가 모양을 잘라 냄)
const svg = (rounded) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="#3fbf7f"/><g transform="translate(0 -18)">${art}</g></svg>`);

const jobs = [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, true],
];
for (const [name, size, rounded] of jobs) {
  await sharp(svg(rounded), { density: 300 }).resize(size, size).png().toFile(join(out, name));
  console.log('wrote', name);
}
