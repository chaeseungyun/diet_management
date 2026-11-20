'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 임시 깜짝 이벤트 (하루만 쓰고 지운다). 이 파일 + public/cheer/ + (app)/layout.tsx 의 두 줄이 전부다.
 * 서버·DB 는 건드리지 않는다. 고양이 사진은 scikit-image 의 chelsea.png (CC0).
 */

const COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff8fd8', '#b388ff', '#ffa94d'];
const SEEN_KEY = 'cheer-seen-2026-11-20';
const EMOJI = ['🎉', '🌸', '⭐', '💖', '🍀', '🐱'];

type Particle = {
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  size: number;
  rot: number;
  vr: number; // rad/s
  color: string;
  sprite: HTMLCanvasElement | null;
  age: number; // s
  ttl: number;
};

const MAX_PARTICLES = 320;
const GRAVITY = 1150; // px/s²
const DRAG = 0.9; // 1/s
const SPRITE_PX = 64;

/** 이모지를 매 프레임 글자로 그리면 느리다(특히 아이폰). 한 번만 그려 두고 이미지로 찍는다 */
function makeSprites(): HTMLCanvasElement[] {
  return EMOJI.map((e) => {
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE_PX;
    const g = c.getContext('2d');
    if (g) {
      g.font = `${SPRITE_PX * 0.8}px serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e, SPRITE_PX / 2, SPRITE_PX / 2 + 2);
    }
    return c;
  });
}

function burst(
  list: Particle[],
  sprites: HTMLCanvasElement[],
  x: number,
  y: number,
  angle: number,
  count: number,
) {
  const room = Math.min(count, MAX_PARTICLES - list.length);
  for (let i = 0; i < room; i++) {
    const a = angle + (Math.random() - 0.5) * 1.1;
    const speed = 560 + Math.random() * 720;
    list.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 7 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 12,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      sprite:
        sprites.length && Math.random() < 0.1
          ? sprites[Math.floor(Math.random() * sprites.length)]!
          : null,
      age: 0,
      ttl: 2.4 + Math.random() * 1.2,
    });
  }
}

export function CheerSurprise({ auto }: { auto: boolean }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    // 본인 확인용 미리보기: 주소 뒤에 ?cheer=1
    if (new URLSearchParams(window.location.search).has('cheer')) return setOpen(true);
    if (!auto) return;
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch {
      // 저장소를 못 쓰는 환경이면 그냥 보여 준다
    }
    setOpen(true);
  }, [auto]);

  /** 닫을 때 기록한다. 띄우자마자 기록하면 보기도 전에 새로고침한 경우 놓친다 */
  const close = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // 무시
    }
    setOpen(false);
  }, []);

  const sprites = useRef<HTMLCanvasElement[]>([]);
  const dprRef = useRef(1);
  const raf = useRef(0);
  const last = useRef(0);

  /** 시간 기준으로 움직인다: 프레임이 떨어져도 느려지지 않고 같은 속도로 보인다 */
  const tick = useCallback((now: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      raf.current = 0;
      return;
    }
    const dt = Math.min((now - (last.current || now)) / 1000, 0.05);
    last.current = now;
    const dpr = dprRef.current;
    const h = window.innerHeight;
    const drag = Math.exp(-DRAG * dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const list = particles.current;
    let alive = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      p.age += dt;
      p.vy += GRAVITY * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.age >= p.ttl || p.y > h + 60) continue;
      list[alive++] = p;

      const left = p.ttl - p.age;
      ctx.globalAlpha = left < 0.5 ? left * 2 : 1;
      const cos = Math.cos(p.rot) * dpr;
      const sin = Math.sin(p.rot) * dpr;
      ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
      if (p.sprite) {
        const s = p.size * 2.2;
        ctx.drawImage(p.sprite, -s / 2, -s / 2, s, s);
      } else {
        // 회전하며 뒤집히는 종이 느낌
        const flip = p.size * 0.6 * Math.cos(p.rot * 1.7);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -flip / 2, p.size, flip);
      }
    }
    list.length = alive;
    ctx.globalAlpha = 1;

    // 남은 조각이 없으면 루프를 멈춘다. 다음 fire 가 다시 돌린다
    raf.current = alive ? requestAnimationFrame(tickRef.current) : 0;
  }, []);
  const tickRef = useRef(tick);

  const fire = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const n = w < 640 ? 45 : 70;
    const list = particles.current;
    burst(list, sprites.current, 0, h, -Math.PI / 3, n);
    burst(list, sprites.current, w, h, (-Math.PI * 2) / 3, n);
    burst(list, sprites.current, w / 2, h * 0.45, -Math.PI / 2, Math.round(n / 2));
    if (!raf.current) {
      last.current = 0;
      raf.current = requestAnimationFrame(tickRef.current);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    sprites.current = makeSprites();

    const resize = () => {
      // 해상도는 1.5배까지만: 채울 픽셀이 줄어 저사양 폰에서도 프레임이 유지된다
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      dprRef.current = dpr;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    fire();
    const timers = [900, 1900].map((ms) => window.setTimeout(fire, ms));

    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', resize);
      particles.current = [];
    };
  }, [open, fire]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="응원 메시지"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cheer/cat.png"
          alt="귀여운 고양이"
          width={451}
          height={300}
          className="block h-auto w-full"
        />
        <div className="flex flex-col items-center gap-3 p-5 text-center">
          <p className="text-3xl" aria-hidden>
            🎉🐱💖
          </p>
          <h2 className="text-xl font-bold leading-snug [word-break:keep-all]">
            김현지의 임용고시를
            <br />
            응원합니다! 📚✨
          </h2>
          <p className="text-sm text-muted-foreground">
            오늘도 한 끼 한 끼 든든하게, 끝까지 화이팅 🍀💪
          </p>
          <div className="mt-1 flex w-full gap-2">
            <button
              type="button"
              onClick={fire}
              className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
            >
              한 번 더 🎉
            </button>
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
            >
              고마워요 💖
            </button>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 size-full" />
    </div>
  );
}
