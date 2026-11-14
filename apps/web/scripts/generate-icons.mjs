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

// 토큰: --primary #3fbf7f, --accent-foreground #14633f (globals.css). 바탕은 --primary 앞뒤의 대각선 그라데이션.
// 새싹 + 밥(흰색) + 웃는 그릇(진초록, 볼터치) (DEC-083)
const art = `
  <path d="M256 140 V112" stroke="#14633f" stroke-width="9" stroke-linecap="round"/>
  <path d="M256 116 C232 116 222 100 222 86 C246 86 256 100 256 116 Z" fill="#14633f"/>
  <path d="M256 110 C280 110 292 94 292 78 C268 78 256 92 256 110 Z" fill="#1c7a4f"/>
  <circle cx="198" cy="218" r="48" fill="#fff"/><circle cx="256" cy="194" r="62" fill="#fff"/>
  <circle cx="314" cy="218" r="48" fill="#fff"/><rect x="150" y="216" width="212" height="40" fill="#fff"/>
  <path d="M118 244 H394 Q405 244 404 256 C396 332 336 386 256 386 C176 386 116 332 108 256 Q107 244 118 244 Z" fill="#14633f"/>
  <rect x="208" y="376" width="96" height="26" rx="11" fill="#14633f"/>
  <circle cx="212" cy="300" r="12" fill="#fff"/><circle cx="300" cy="300" r="12" fill="#fff"/>
  <path d="M236 316 Q256 340 276 316" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
  <ellipse cx="178" cy="324" rx="16" ry="10" fill="#ff9f8f" opacity=".8"/>
  <ellipse cx="334" cy="324" rx="16" ry="10" fill="#ff9f8f" opacity=".8"/>`;

// any: 둥근 사각형(투명 모서리). maskable·apple: 꽉 찬 사각형(런처·iOS 가 모양을 잘라 냄)
const svg = (rounded) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6fdea3"/><stop offset="1" stop-color="#2ba56a"/></linearGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#bg)"/><g transform="translate(0 4)">${art}</g></svg>`);

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
