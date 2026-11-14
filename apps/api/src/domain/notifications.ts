/**
 * 식사 알림 판정 (FR-09, D-12·D-19·D-22, DEC-074·075). 저장하지 않고 발송 시점에 계산한다.
 * 스케줄러가 매분 이 함수로 "지금 보낼 알림" 만 고르고, 그 행을 유니크 선점한 뒤 보낸다.
 * DB·시계에 의존하지 않는 순수 함수라 시간대·날짜 경계·재알림 규칙을 단위 테스트로 덮는다.
 */
import type { DeliveryStatus, MealSlot, MealStatus, PlanType } from '@prisma/client';
import { MEAL_SLOTS, todayIn } from '@diet/shared';
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
  type: 'meal_check' | 'unrecorded_remind' | 'stock_depletion' | 'day_complete';
  targetDate: DateString;
  /** 식사 알림은 끼니 이름, 소진 알림 묶음은 'bundle', 하루 완료는 'day' */
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

// ---------- 하루 완료 알림 (DEC-084) ----------

/** 마지막 끼니 기록 뒤 이만큼 지나도 하루 완료를 누르지 않았으면 알린다 */
export const DAY_COMPLETE_AFTER_MS = 60 * 60_000;

export interface DayCompleteInput {
  now: Date;
  timezone: string;
  enabled: boolean;
  /** 가입일(사용자 시간대). 그 앞 날짜는 완료가 없다 */
  signupDate: DateString;
  activeSlots: readonly MealSlot[];
  plan: (date: DateString, slot: MealSlot) => { planType: PlanType };
  /** 그 날짜·끼니의 정규 기록. 없으면 null(= 미기록) */
  record: (date: DateString, slot: MealSlot) => { status: MealStatus; updatedAt: Date } | null;
  /** 이미 하루 완료를 누른 날짜 */
  completed: ReadonlySet<DateString>;
  /** 이미 하루 완료 알림을 보냈거나 보내는 중인 날짜(하루에 한 번만). 실패·만료한 날은 넣지 않는다 */
  notified: ReadonlySet<DateString>;
  /**
   * 발송이 실패·만료한 날짜와 그때의 예약 시각. 같은(또는 더 이른) 예약 시각으로는 다시 보내지 않는다 —
   * 기록을 고쳐 예약 시각이 뒤로 갔을 때만 다시 시도한다(실패 직후 매분 재시도하지 않게).
   */
  failedAt?: ReadonlyMap<DateString, Date>;
  /**
   * 쓰는 끼니 중 가장 늦은 끼니의 시각(하루 중 분). 이 시각 전에는 보내지 않는다 —
   * 저녁이 자유 끼니인 날 점심만 적고 '모두 기록했어요' 가 오지 않게. 쓰는 끼니가 없으면 null.
   */
  lastSlotMinute: number | null;
}

export interface DueDayComplete {
  targetDate: DateString;
  scheduledAt: Date;
}

/**
 * 지금 보낼 하루 완료 알림. 조건(모두 만족):
 * 켜져 있음 · 쓰는 끼니 중 식단 끼니에 미기록 없음(하루 완료 버튼이 눌리는 상태, D-20) ·
 * 기록한 끼니가 하나 이상 · 아직 완료하지 않음 · 그 날짜에 보낸 적 없음 ·
 * 예약 시각 ≤ 지금 ≤ 예약 시각 + 15분.
 * 예약 시각 = (마지막 기록 시각 + 1시간) 과 (그날 가장 늦은 쓰는 끼니의 시각) 중 늦은 쪽.
 * 어제·오늘을 봐서 23:30 에 마지막 끼니를 적은 날도 00:30 에 알린다.
 * 다만 마지막 기록이 그 날짜 안에 적힌 것일 때만이다(다음 날 어제 기록을 고쳐도 '어제' 알림은 없다).
 */
export function dueDayComplete(input: DayCompleteInput): DueDayComplete[] {
  if (!input.enabled) return [];
  const active = new Set(input.activeSlots);
  const out: DueDayComplete[] = [];
  for (const date of candidateDates(input.now, input.timezone)) {
    if (date < input.signupDate || input.completed.has(date) || input.notified.has(date)) continue;
    let blocked = false;
    let last: Date | null = null;
    for (const slot of MEAL_SLOTS) {
      const r = input.record(date, slot);
      const recorded = r !== null && r.status !== 'unrecorded';
      if (recorded) {
        if (!last || r.updatedAt > last) last = r.updatedAt;
      } else if (active.has(slot) && input.plan(date, slot).planType === 'template') {
        blocked = true;
        break;
      }
    }
    if (blocked || !last) continue;
    // 지난 날짜의 기록을 다음 날 고친 것으로는 알리지 않는다. 그날 안에 적은 기록만 기준이 된다
    if (todayIn(input.timezone, last) !== date) continue;
    const afterRecord = last.getTime() + DAY_COMPLETE_AFTER_MS;
    const lastSlot =
      input.lastSlotMinute === null
        ? 0
        : zonedMinuteToUtc(date, input.lastSlotMinute, input.timezone).getTime();
    const scheduledAt = new Date(Math.max(afterRecord, lastSlot));
    const failed = input.failedAt?.get(date);
    if (failed && scheduledAt <= failed) continue;
    if (inWindow(input.now, scheduledAt)) out.push({ targetDate: date, scheduledAt });
  }
  return out;
}

// ---------- 소진 알림 (DEC-084) ----------

/** 소진 임박 기준 기본값: 예측 소진일 N일 전 (스키마 기본값과 같다) */
export const DEFAULT_DAYS_BEFORE = 3;

/** 소진 알림 시각 기본값: 사용자 시간대 09:00 */
export const DEFAULT_STOCK_NOTIFY_MINUTE = 9 * 60;

/**
 * 오늘 소진 알림을 판정할 때인가: 켜져 있고, 알림 시각 ≤ 지금 ≤ + 15분.
 * 이미 오늘 행이 있는지는 호출하는 쪽이 본다(하루 한 통).
 */
export function stockAlertScheduledAt(
  now: Date,
  timezone: string,
  notifyMinute: number | null,
): Date | null {
  const today = todayIn(timezone, now);
  const scheduledAt = zonedMinuteToUtc(
    today,
    notifyMinute ?? DEFAULT_STOCK_NOTIFY_MINUTE,
    timezone,
  );
  return inWindow(now, scheduledAt) ? scheduledAt : null;
}

export interface DepletionCandidate {
  productId: string;
  name: string;
  /** 예측 소진일 */
  depletionDate: DateString;
  daysLeft: number;
}
