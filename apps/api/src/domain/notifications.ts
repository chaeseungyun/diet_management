/**
 * 식사 알림 판정 (FR-09, D-12·D-19·D-22, DEC-074·075). 저장하지 않고 발송 시점에 계산한다.
 * 스케줄러가 매분 이 함수로 "지금 보낼 알림" 만 고르고, 그 행을 유니크 선점한 뒤 보낸다.
 * DB·시계에 의존하지 않는 순수 함수라 시간대·날짜 경계·재알림 규칙을 단위 테스트로 덮는다.
 */
import type { DeliveryStatus, MealSlot, MealStatus, PlanType } from '@prisma/client';
import { todayIn } from '@diet/shared';
import { addDays, type DateString } from './dates';

/** 예약 시각이 이만큼 넘게 지난 알림은 보내지 않는다(재시작 폭주 방지, DEC-074) */
export const GRACE_MS = 15 * 60_000;

/** 일시 실패 재시도 상한(첫 시도 포함) */
export const MAX_ATTEMPTS = 3;

// ---------- 시간대 ----------

function localParts(tz: string, ts: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    mi: get('minute'),
    s: get('second'),
  };
}

/** tz 의 현지 시각 − UTC (ms) */
function offsetMs(tz: string, ts: number): number {
  const p = localParts(tz, ts);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - (ts - (((ts % 1000) + 1000) % 1000));
}

/**
 * tz 기준 date 의 하루 중 minute 분(0~1439)을 UTC 시각으로 바꾼다.
 * 서머타임으로 없는 시각(봄 02:30)은 그 뒤 시각으로, 두 번 있는 시각(가을 01:30)은 앞 시각으로.
 */
export function zonedMinuteToUtc(date: DateString, minute: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const h = Math.floor(minute / 60);
  const mi = minute % 60;
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const ts1 = guess - offsetMs(tz, guess);
  const ts2 = guess - offsetMs(tz, ts1);
  const matches = (ts: number): boolean => {
    const p = localParts(tz, ts);
    return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi;
  };
  const candidates = [ts2, ts1].sort((a, b) => a - b);
  const exact = candidates.find(matches);
  return new Date(exact ?? Math.max(ts1, ts2));
}

// ---------- 판정 ----------

export interface SlotSetting {
  slot: MealSlot;
  enabled: boolean;
  /** 사용자 시간대 기준 하루 중 분. null 이면 보내지 않는다 */
  notifyMinute: number | null;
}

export interface RemindSetting {
  enabled: boolean;
  afterMinutes: number;
  /** 재알림 횟수 0~3 */
  maxCount: number;
}

export interface DeliveryLite {
  type: 'meal_check' | 'unrecorded_remind' | 'stock_depletion';
  targetDate: DateString;
  /** 식사 알림은 끼니 이름 */
  targetKey: string;
  seq: number;
  status: DeliveryStatus;
  sentAt: Date | null;
}

export interface DueInput {
  now: Date;
  timezone: string;
  activeSlots: readonly MealSlot[];
  slotSettings: readonly SlotSetting[];
  remind: RemindSetting;
  /** 그 날짜·끼니의 계획 (D-01 해석기) */
  plan: (date: DateString, slot: MealSlot) => { planType: PlanType; templateId: string | null };
  /** 그 날짜·끼니의 정규 기록 상태. 기록이 없으면 null(= 미기록) */
  status: (date: DateString, slot: MealSlot) => MealStatus | null;
  /** 어제·오늘의 식사 알림 발송 기록 */
  deliveries: readonly DeliveryLite[];
}

export interface DueNotification {
  type: 'meal_check' | 'unrecorded_remind';
  targetDate: DateString;
  slot: MealSlot;
  /** 0 = 첫 알림, 1~3 = 재알림 회차 */
  seq: number;
  scheduledAt: Date;
  templateId: string | null;
}

function inWindow(now: Date, scheduledAt: Date): boolean {
  const late = now.getTime() - scheduledAt.getTime();
  return late >= 0 && late <= GRACE_MS;
}

/** 오늘·어제 날짜(사용자 시간대). 자정 직전 알림과 그 재알림을 자정 뒤에도 처리한다 */
export function candidateDates(now: Date, tz: string): DateString[] {
  const today = todayIn(tz, now);
  return [addDays(today, -1), today];
}

/**
 * 지금 보낼 식사 알림. 조건(모두 만족):
 * 끼니 알림이 켜져 있고 시각이 있음 · 쓰는 끼니 · 계획이 식단 끼니(자유 끼니 제외, D-19) · 미기록 ·
 * 예약 시각 ≤ 지금 ≤ 예약 시각 + 15분 · 같은 (날짜, 끼니, 회차) 행이 아직 없음.
 * 재알림 n 은 직전 회차가 sent 이고 그 발송 시각 + 간격이 예약 시각이다(DEC-075).
 */
export function dueMealNotifications(input: DueInput): DueNotification[] {
  const active = new Set(input.activeSlots);
  const out: DueNotification[] = [];

  for (const date of candidateDates(input.now, input.timezone)) {
    for (const s of input.slotSettings) {
      if (!s.enabled || s.notifyMinute === null || !active.has(s.slot)) continue;
      const plan = input.plan(date, s.slot);
      if (plan.planType !== 'template') continue;
      const status = input.status(date, s.slot);
      if (status !== null && status !== 'unrecorded') continue;

      const mine = input.deliveries
        .filter(
          (d) =>
            d.targetDate === date &&
            d.targetKey === s.slot &&
            (d.type === 'meal_check' || d.type === 'unrecorded_remind'),
        )
        .sort((a, b) => a.seq - b.seq);
      const last = mine[mine.length - 1];

      if (!last) {
        const scheduledAt = zonedMinuteToUtc(date, s.notifyMinute, input.timezone);
        if (inWindow(input.now, scheduledAt)) {
          out.push({
            type: 'meal_check',
            targetDate: date,
            slot: s.slot,
            seq: 0,
            scheduledAt,
            templateId: plan.templateId,
          });
        }
        continue;
      }

      // 재알림: 직전 회차가 실제로 나갔을 때만 이어 간다. 실패·만료·발송 중이면 멈춘다
      if (!input.remind.enabled || last.seq >= input.remind.maxCount) continue;
      if (last.status !== 'sent' || !last.sentAt) continue;
      const scheduledAt = new Date(last.sentAt.getTime() + input.remind.afterMinutes * 60_000);
      if (inWindow(input.now, scheduledAt)) {
        out.push({
          type: 'unrecorded_remind',
          targetDate: date,
          slot: s.slot,
          seq: last.seq + 1,
          scheduledAt,
          templateId: plan.templateId,
        });
      }
    }
  }
  return out;
}
