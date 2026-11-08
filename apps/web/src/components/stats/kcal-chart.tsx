import type { Schemas } from '@/lib/api';
import { EmptyState } from '@/components/ui/card';

type Day = Schemas['StatsDayDto'];

/**
 * 일별 열량 막대 + 당시 목표선 (S-60, FR-06, D-20). 라이브러리 없이 SVG.
 * - 완료한 날만 막대를 그린다. 미완료일은 0 이 아니라 빈 칸이다(미기록 ≠ 0).
 * - 영양 불완전(완료했지만 kcal 미상 포함)은 같은 색의 빗금 + 외곽선으로 '기록된 합계' 임을 보인다.
 *   색 하나만으로 구분하지 않는다(NFR-01). 정확한 값은 아래 날짜별 표가 대신한다.
 * - 열량은 차트 색이 아니라 primary, 목표선은 chart-5 (design-tokens §3).
 */
export function KcalChart({ days }: { days: Day[] }) {
  const tracked = days.filter((d) => d.tracked);
  const bars = tracked.filter((d) => d.completed);
  if (bars.length === 0) return <EmptyState>완료한 날이 없어 그릴 데이터가 없습니다</EmptyState>;

  const w = 640;
  const h = 200;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const n = days.length;
  const slot = (w - pad.l - pad.r) / n;
  const barW = Math.max(2, Math.min(28, slot - 2)); // 막대 사이 2px 이상 비움
  const goals = days.map((d) => d.goalKcal).filter((g): g is number => g !== null);
  const maxV = Math.max(...bars.map((d) => d.kcal), ...goals, 100);
  const top = Math.ceil((maxV * 1.1) / 100) * 100;
  const y = (v: number) => pad.t + ((top - v) / top) * (h - pad.t - pad.b);
  const x = (i: number) => pad.l + i * slot + (slot - barW) / 2;
  const base = y(0);
  const r = Math.min(4, barW / 2);
  const ticks = [0, Math.round(top / 2), top];

  // 목표가 바뀐 날을 계단선으로
  const goalPath = days
    .map((d, i) => (d.goalKcal === null ? null : { i, g: d.goalKcal }))
    .reduce<string[]>((acc, p, idx, arr) => {
      if (!p) return acc;
      const x0 = pad.l + p.i * slot;
      const x1 = x0 + slot;
      const prev = arr[idx - 1];
      acc.push(`${prev && prev.g === p.g ? 'L' : 'M'}${x0.toFixed(1)},${y(p.g).toFixed(1)}`);
      acc.push(`L${x1.toFixed(1)},${y(p.g).toFixed(1)}`);
      return acc;
    }, [])
    .join(' ');

  const labelEvery = n <= 7 ? 1 : n <= 14 ? 2 : 7;

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full rounded-xl border border-border bg-card"
        role="img"
        aria-label="일별 열량과 목표"
      >
        <defs>
          <pattern
            id="kcal-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--primary)" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((v) => (
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
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const day = Number(d.date.slice(8));
          const label = i % labelEvery === 0 || i === n - 1;
          const show = d.tracked && d.completed;
          const incomplete = show && !d.complete.kcal;
          const top = y(d.kcal);
          const hgt = Math.max(0, base - top);
          const tip = !d.tracked
            ? `${d.date} 추적 대상 아님`
            : !d.completed
              ? `${d.date} 미완료 (평균 제외)`
              : `${d.date} ${Math.round(d.kcal)} kcal${incomplete ? ' · 영양 불완전(기록된 합계)' : ''}${
                  d.goalKcal !== null ? ` · 목표 ${d.goalKcal}` : ''
                }`;
          return (
            <g key={d.date}>
              {show && hgt > 0 ? (
                <path
                  d={roundedTop(x(i), top, barW, hgt, r)}
                  fill={incomplete ? 'url(#kcal-hatch)' : 'var(--primary)'}
                  stroke={incomplete ? 'var(--primary)' : 'none'}
                  strokeWidth={incomplete ? 1.5 : 0}
                />
              ) : null}
              {show && hgt === 0 ? (
                <line
                  x1={x(i)}
                  x2={x(i) + barW}
                  y1={base - 1}
                  y2={base - 1}
                  stroke="var(--primary)"
                  strokeWidth="2"
                />
              ) : null}
              {/* 마크보다 넓은 hover 영역 */}
              <rect
                x={pad.l + i * slot}
                y={pad.t}
                width={slot}
                height={base - pad.t}
                fill="transparent"
              >
                <title>{tip}</title>
              </rect>
              {label ? (
                <text
                  x={pad.l + i * slot + slot / 2}
                  y={h - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill={d.tracked ? 'var(--muted-foreground)' : 'var(--border)'}
                >
                  {day}
                </text>
              ) : null}
            </g>
          );
        })}
        {goalPath ? (
          <path
            d={goalPath}
            fill="none"
            stroke="var(--chart-5)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        ) : null}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-sm bg-primary" /> 완료한 날 kcal
        </span>
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <rect
              x="0.75"
              y="0.75"
              width="10.5"
              height="10.5"
              rx="2"
              fill="url(#kcal-hatch)"
              stroke="var(--primary)"
              strokeWidth="1.5"
            />
          </svg>
          영양 불완전(기록된 합계)
        </span>
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 4" className="h-1 w-4" aria-hidden>
            <line
              x1="0"
              y1="2"
              x2="16"
              y2="2"
              stroke="var(--chart-5)"
              strokeWidth="2"
              strokeDasharray="5 3"
            />
          </svg>
          그 날의 목표
        </span>
        <span>빈 칸 = 미완료(0 이 아님)</span>
      </figcaption>
    </figure>
  );
}

/** 위쪽 두 모서리만 둥근 막대 (기준선 쪽은 각지게) */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}
