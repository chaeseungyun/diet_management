import type { Schemas } from '@/lib/api';
import { EmptyState } from '@/components/ui/card';

/** 측정값 점·선(chart-4) + 목표선(chart-5). 라이브러리 없이 SVG (design-tokens.md §3 차트 색) */
export function WeightChart({
  items,
  target,
}: {
  items: Schemas['WeightDto'][];
  target: number | null;
}) {
  if (items.length === 0) return <EmptyState>측정 데이터 없음</EmptyState>;
  const pts = [...items].sort((a, b) => (a.date < b.date ? -1 : 1));
  const w = 320;
  const h = 140;
  const pad = { l: 36, r: 8, t: 8, b: 20 };
  const xs = pts.map((p) => Date.parse(p.date));
  const ys = pts.map((p) => p.weightKg);
  const allY = target !== null ? [...ys, target] : ys;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs, minX + 86_400_000);
  const minY = Math.floor(Math.min(...allY) - 1);
  const maxY = Math.ceil(Math.max(...allY) + 1);
  const x = (v: number) => pad.l + ((v - minX) / (maxX - minX)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + ((maxY - v) / (maxY - minY)) * (h - pad.t - pad.b);
  const path = pts
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${x(Date.parse(p.date)).toFixed(1)},${y(p.weightKg).toFixed(1)}`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full rounded-xl border border-border bg-card"
      role="img"
      aria-label="체중 추이"
    >
      {[minY, (minY + maxY) / 2, maxY].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <text
            x={pad.l - 4}
            y={y(v) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {target !== null ? (
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={y(target)}
          y2={y(target)}
          stroke="var(--chart-5)"
          strokeDasharray="4 3"
          strokeWidth="1.5"
        />
      ) : null}
      <path d={path} fill="none" stroke="var(--chart-4)" strokeWidth="2" />
      {pts.map((p) => (
        <circle
          key={p.date}
          cx={x(Date.parse(p.date))}
          cy={y(p.weightKg)}
          r="3"
          fill="var(--chart-4)"
        >
          <title>{`${p.date} ${p.weightKg} kg`}</title>
        </circle>
      ))}
      <text x={pad.l} y={h - 6} fontSize="9" fill="var(--muted-foreground)">
        {pts[0]!.date}
      </text>
      <text x={w - pad.r} y={h - 6} fontSize="9" textAnchor="end" fill="var(--muted-foreground)">
        {pts.at(-1)!.date}
      </text>
    </svg>
  );
}
