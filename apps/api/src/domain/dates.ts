/**
 * 날짜 유틸. 사용자 시간대 기준 날짜는 항상 'YYYY-MM-DD' 문자열로 다루고,
 * Prisma @db.Date 컬럼과는 UTC 자정 Date 로 주고받는다 (NFR-02, D-21).
 */
import { isValidDateString } from '@diet/shared';

export type DateString = string;

export function assertDate(s: string): DateString {
  if (!isValidDateString(s)) throw new Error(`invalid date: ${s}`);
  return s;
}

/** 'YYYY-MM-DD' → Prisma @db.Date 저장용 Date (UTC 자정) */
export function toDbDate(s: DateString): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Prisma @db.Date 값 → 'YYYY-MM-DD' */
export function fromDbDate(d: Date): DateString {
  return d.toISOString().slice(0, 10);
}

/** ISO 요일 1=월 … 7=일 (요구사항 §7-7) */
export function isoWeekday(s: DateString): number {
  const w = toDbDate(s).getUTCDay();
  return w === 0 ? 7 : w;
}

export function addDays(s: DateString, n: number): DateString {
  const d = toDbDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDbDate(d);
}

/** from..to 를 포함하는 날짜 목록. 상한을 넘기면 예외 (API 는 그 전에 422 로 거른다) */
export function eachDate(from: DateString, to: DateString, max = 400): DateString[] {
  if (from > to) return [];
  const out: DateString[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (out.length > max) throw new Error(`date range too long (> ${max} days)`);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 문자열 비교로 충분하다(고정 폭 ISO 형식) */
export function daysBetween(from: DateString, to: DateString): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}
