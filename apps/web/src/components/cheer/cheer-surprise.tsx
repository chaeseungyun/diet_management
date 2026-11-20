'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 임시 깜짝 이벤트 (하루만 쓰고 지운다). 이 파일 + public/cheer/ + (app)/layout.tsx 의 두 줄이 전부다.
 * 서버·DB 는 건드리지 않는다. 고양이 사진은 scikit-image 의 chelsea.png (CC0).
 */

const COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff8fd8', '#b388ff', '#ffa94d'];
const EMOJI = ['🎉', '🌸', '⭐', '💖', '🍀', '🐱'];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  emoji: string | null;
  life: number;
};

function burst(list: Particle[], x: number, y: number, angle: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * 1.1;
    const speed = 9 + Math.random() * 12;
    list.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 6 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      emoji: Math.random() < 0.12 ? EMOJI[Math.floor(Math.random() * EMOJI.length)]! : null,
      life: 1,
    });
  }
}

export function CheerSurprise({ auto }: { auto: boolean }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    // 본인 확인용 미리보기: 주소 뒤에 ?cheer=1
    if (auto || new URLSearchParams(window.location.search).has('cheer')) setOpen(true);
  }, [auto]);

  const fire = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const n = w < 640 ? 70 : 110;
    burst(particles.current, 0, h, -Math.PI / 3, n);
    burst(particles.current, w, h, (-Math.PI * 2) / 3, n);
    burst(particles.current, w / 2, h * 0.45, -Math.PI / 2, Math.round(n / 2));
  }, []);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    fire();
    const timers = [700, 1500, 2400].map((ms) => window.setTimeout(fire, ms));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const list = particles.current;
      for (const p of list) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.emoji) {
          ctx.font = `${p.size * 2.4}px serif`;
          ctx.textAlign = 'center';
          ctx.fillText(p.emoji, 0, 0);
        } else {
          ctx.fillStyle = p.color;
          // 회전하며 뒤집히는 종이 느낌
          ctx.fillRect(
            -p.size / 2,
            (-p.size * 0.6 * Math.cos(p.rot * 3)) / 2,
            p.size,
            p.size * 0.6 * Math.cos(p.rot * 3),
          );
        }
        ctx.restore();
      }
      particles.current = list.filter((p) => p.life > 0 && p.y < window.innerHeight + 60);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
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
              onClick={() => setOpen(false)}
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
