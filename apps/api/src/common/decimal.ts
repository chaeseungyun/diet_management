import { Prisma } from '@prisma/client';

/** Decimal → 응답용 number. null 은 미상 그대로 (NFR-02). */
export function num(d: Prisma.Decimal | null | undefined): number | null {
  return d === null || d === undefined ? null : d.toNumber();
}

export function numReq(d: Prisma.Decimal): number {
  return d.toNumber();
}

/** 요청 number → Decimal. undefined/null 은 그대로 통과 */
export function dec(n: number): Prisma.Decimal;
export function dec(n: number | null | undefined): Prisma.Decimal | null;
export function dec(n: number | null | undefined): Prisma.Decimal | null {
  return n === null || n === undefined ? null : new Prisma.Decimal(n);
}
