import { WEEKDAY_LABELS, formatQuantity, type Weekday } from '@diet/shared';

/** 'YYYY-MM-DD' → ISO 요일 1..7 */
export function weekdayOf(date: string): Weekday {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (w === 0 ? 7 : w) as Weekday;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** '11월 6일 (목)' */
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

/** '2026년 11월' */
export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

export function kcal(n: number | null | undefined): string {
  return n === null || n === undefined ? '미상' : `${Math.round(n)} kcal`;
}

export function grams(n: number | null | undefined): string {
  return n === null || n === undefined ? '미상' : `${formatQuantity(n, 1)}g`;
}

/** '0.5팩 (50g)' 처럼 재고 단위 + g 병기 (D-02) */
export function quantityWithGrams(
  qty: number | null | undefined,
  unit: string,
  displayUnit: string,
  packWeightG: number | null,
): string {
  if (qty === null || qty === undefined) return '–';
  const base = `${formatQuantity(qty)}${displayUnit}`;
  if (unit === 'ea' && packWeightG) return `${base} (${formatQuantity(qty * packWeightG, 1)}g)`;
  return base;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 월 캘린더 격자 (월요일 시작). null 은 빈 칸 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // 월=0
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
