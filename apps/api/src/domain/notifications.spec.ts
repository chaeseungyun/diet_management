import type { MealSlot, MealStatus, PlanType } from '@prisma/client';
import {
  type DayCompleteInput,
  type DeliveryLite,
  type DueInput,
  dueDayComplete,
  dueMealNotifications,
  GRACE_MS,
  stockAlertScheduledAt,
  zonedMinuteToUtc,
} from './notifications';

const SEOUL = 'Asia/Seoul';
const ALL: MealSlot[] = ['breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'];

/** 서울 2026-11-10 hh:mm 의 UTC 시각 */
const kst = (hhmm: string, date = '2026-11-10'): Date => new Date(`${date}T${hhmm}:00+09:00`);

function input(over: Partial<DueInput> = {}): DueInput {
  return {
    now: kst('12:00'),
    timezone: SEOUL,
    activeSlots: ALL,
    slotSettings: [{ slot: 'lunch', enabled: true, notifyMinute: 12 * 60 }],
    remind: { enabled: true, afterMinutes: 60, maxCount: 1 },
    plan: () => ({ planType: 'template' as PlanType, templateId: 't1' }),
    status: () => null,
    deliveries: [],
    ...over,
  };
}

const sent = (seq: number, at: Date, over: Partial<DeliveryLite> = {}): DeliveryLite => ({
  type: seq === 0 ? 'meal_check' : 'unrecorded_remind',
  targetDate: '2026-11-10',
  targetKey: 'lunch',
  seq,
  status: 'sent',
  sentAt: at,
  ...over,
});

describe('zonedMinuteToUtc', () => {
  it('converts Seoul local time (no DST)', () => {
    expect(zonedMinuteToUtc('2026-11-10', 12 * 60, SEOUL).toISOString()).toBe(
      '2026-11-10T03:00:00.000Z',
    );
    expect(zonedMinuteToUtc('2026-11-10', 0, SEOUL).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('handles New York DST gaps and overlaps', () => {
    // 2026-03-08 02:30 은 없는 시각 → 그 뒤(03:30 EDT)
    expect(zonedMinuteToUtc('2026-03-08', 150, 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // 2026-11-01 01:30 은 두 번 → 앞(EDT)
    expect(zonedMinuteToUtc('2026-11-01', 90, 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    // 평일 겨울(EST)
    expect(zonedMinuteToUtc('2026-12-01', 12 * 60, 'America/New_York').toISOString()).toBe(
      '2026-12-01T17:00:00.000Z',
    );
  });
});

describe('dueMealNotifications', () => {
  it('sends the first reminder at the set time within the 15 minute window', () => {
    const due = dueMealNotifications(input());
    expect(due).toEqual([
      {
        type: 'meal_check',
        targetDate: '2026-11-10',
        slot: 'lunch',
        seq: 0,
        scheduledAt: kst('12:00'),
        templateId: 't1',
      },
    ]);
    expect(dueMealNotifications(input({ now: kst('12:15') }))).toHaveLength(1);
    expect(dueMealNotifications(input({ now: kst('11:59') }))).toHaveLength(0);
    expect(
      dueMealNotifications(input({ now: new Date(kst('12:00').getTime() + GRACE_MS + 1) })),
    ).toHaveLength(0);
  });

  it('skips disabled, untimed, hidden and free slots (D-18·D-19)', () => {
    expect(
      dueMealNotifications(
        input({ slotSettings: [{ slot: 'lunch', enabled: false, notifyMinute: 720 }] }),
      ),
    ).toHaveLength(0);
    expect(
      dueMealNotifications(
        input({ slotSettings: [{ slot: 'lunch', enabled: true, notifyMinute: null }] }),
      ),
    ).toHaveLength(0);
    expect(dueMealNotifications(input({ activeSlots: ['breakfast', 'dinner'] }))).toHaveLength(0);
    expect(
      dueMealNotifications(input({ plan: () => ({ planType: 'none', templateId: null }) })),
    ).toHaveLength(0);
  });

  it('stops once the meal is recorded and resumes when cancelled', () => {
    for (const s of ['eaten', 'skipped'] as MealStatus[]) {
      expect(dueMealNotifications(input({ status: () => s }))).toHaveLength(0);
    }
    // 취소 = unrecorded 상태로 되돌림 → 다시 대상
    expect(dueMealNotifications(input({ status: () => 'unrecorded' }))).toHaveLength(1);
  });

  it('does not repeat a delivery that already exists in any status', () => {
    for (const status of ['pending', 'sent', 'failed', 'skipped'] as const) {
      expect(
        dueMealNotifications(input({ deliveries: [sent(0, kst('12:00'), { status })] })).filter(
          (d) => d.seq === 0,
        ),
      ).toHaveLength(0);
    }
  });

  it('chains reminders from the previous send time up to the max count', () => {
    const first = sent(0, kst('12:00'));
    const at1300 = dueMealNotifications(input({ now: kst('13:00'), deliveries: [first] }));
    expect(at1300).toMatchObject([
      { type: 'unrecorded_remind', seq: 1, scheduledAt: kst('13:00') },
    ]);
    // 간격 전
    expect(dueMealNotifications(input({ now: kst('12:59'), deliveries: [first] }))).toEqual([]);
    // 상한 1회에 도달
    const second = sent(1, kst('13:00'));
    expect(dueMealNotifications(input({ now: kst('14:00'), deliveries: [first, second] }))).toEqual(
      [],
    );
    // 상한 3회면 이어 간다
    expect(
      dueMealNotifications(
        input({
          now: kst('14:00'),
          deliveries: [first, second],
          remind: { enabled: true, afterMinutes: 60, maxCount: 3 },
        }),
      ),
    ).toMatchObject([{ seq: 2, scheduledAt: kst('14:00') }]);
  });

  it('does not remind when reminders are off, the meal is recorded or the last one did not go out', () => {
    const first = sent(0, kst('12:00'));
    const at = { now: kst('13:00') };
    expect(
      dueMealNotifications(
        input({
          ...at,
          deliveries: [first],
          remind: { enabled: false, afterMinutes: 60, maxCount: 1 },
        }),
      ),
    ).toEqual([]);
    expect(
      dueMealNotifications(
        input({
          ...at,
          deliveries: [first],
          remind: { enabled: true, afterMinutes: 60, maxCount: 0 },
        }),
      ),
    ).toEqual([]);
    expect(
      dueMealNotifications(input({ ...at, deliveries: [first], status: () => 'eaten' })),
    ).toEqual([]);
    expect(
      dueMealNotifications(
        input({ ...at, deliveries: [sent(0, kst('12:00'), { status: 'failed' })] }),
      ),
    ).toEqual([]);
    // 끼니 알림을 끄면 재알림도 멈춘다
    expect(
      dueMealNotifications(
        input({
          ...at,
          deliveries: [first],
          slotSettings: [{ slot: 'lunch', enabled: false, notifyMinute: 720 }],
        }),
      ),
    ).toEqual([]);
  });

  it('a late cancel after the reminder window does not bring the reminder back (DEC-075)', () => {
    // 12:00 알림 → 12:30 먹었음 → 14:00 취소: 13:00~13:15 창이 지났다
    expect(
      dueMealNotifications(input({ now: kst('14:00'), deliveries: [sent(0, kst('12:00'))] })),
    ).toEqual([]);
  });

  it('handles reminders across midnight using yesterday’s date', () => {
    const late = input({
      now: kst('00:05', '2026-11-11'),
      slotSettings: [{ slot: 'evening_snack', enabled: true, notifyMinute: 23 * 60 + 55 }],
    });
    expect(dueMealNotifications(late)).toMatchObject([
      { targetDate: '2026-11-10', slot: 'evening_snack', seq: 0, scheduledAt: kst('23:55') },
    ]);

    const remind = input({
      now: kst('00:30', '2026-11-11'),
      slotSettings: [{ slot: 'evening_snack', enabled: true, notifyMinute: 23 * 60 + 30 }],
      deliveries: [sent(0, kst('23:30'), { targetKey: 'evening_snack' })],
    });
    expect(dueMealNotifications(remind)).toMatchObject([
      { type: 'unrecorded_remind', targetDate: '2026-11-10', seq: 1 },
    ]);
  });

  it('evaluates in the user’s time zone', () => {
    // 같은 순간(UTC 03:00)이 뉴욕에서는 전날 22:00 → 점심 알림 아님
    expect(dueMealNotifications(input({ timezone: 'America/New_York' }))).toEqual([]);
    expect(
      dueMealNotifications(
        input({
          timezone: 'America/New_York',
          slotSettings: [{ slot: 'dinner', enabled: true, notifyMinute: 22 * 60 }],
        }),
      ),
    ).toMatchObject([{ targetDate: '2026-11-09', slot: 'dinner' }]);
  });
});

describe('dueDayComplete (DEC-084)', () => {
  const rec = (hhmm: string, status: MealStatus = 'eaten') => ({ status, updatedAt: kst(hhmm) });
  const on10 = (
    by: Partial<Record<MealSlot, { status: MealStatus; updatedAt: Date }>>,
  ): DayCompleteInput['record'] => {
    return (date, slot) => (date === '2026-11-10' ? (by[slot] ?? null) : null);
  };
  function day(over: Partial<DayCompleteInput> = {}): DayCompleteInput {
    return {
      now: kst('21:00'),
      timezone: SEOUL,
      enabled: true,
      signupDate: '2026-11-01',
      activeSlots: ['lunch', 'dinner'],
      plan: () => ({ planType: 'template' as PlanType }),
      record: on10({ lunch: rec('12:10'), dinner: rec('20:00') }),
      completed: new Set(),
      notified: new Set(),
      lastSlotMinute: 19 * 60,
      ...over,
    };
  }

  it('is due one hour after the last record once every planned meal is recorded', () => {
    expect(dueDayComplete(day())).toEqual([
      { targetDate: '2026-11-10', scheduledAt: kst('21:00') },
    ]);
    expect(dueDayComplete(day({ now: kst('20:59') }))).toEqual([]);
    // 15분을 넘기면 보내지 않는다
    expect(dueDayComplete(day({ now: kst('21:16') }))).toEqual([]);
  });

  it('waits while a planned meal in use is unrecorded, ignoring free and unused slots', () => {
    const noDinner = day({ record: on10({ lunch: rec('20:00') }) });
    expect(dueDayComplete(noDinner)).toEqual([]);
    // 저녁이 자유 끼니이거나 쓰지 않는 끼니면 막지 않는다
    expect(
      dueDayComplete({
        ...noDinner,
        plan: (_d, slot) => ({ planType: slot === 'dinner' ? 'none' : 'template' }),
      }),
    ).toHaveLength(1);
    expect(dueDayComplete({ ...noDinner, activeSlots: ['lunch'] })).toHaveLength(1);
    // '취소' 로 미기록이 된 행은 기록이 아니다
    expect(
      dueDayComplete(
        day({ record: on10({ lunch: rec('12:00'), dinner: rec('20:00', 'unrecorded') }) }),
      ),
    ).toEqual([]);
  });

  it('skips completed, already notified, pre-signup days, days with no record, and when off', () => {
    const d = new Set(['2026-11-10']);
    expect(dueDayComplete(day({ completed: d }))).toEqual([]);
    expect(dueDayComplete(day({ notified: d }))).toEqual([]);
    expect(dueDayComplete(day({ signupDate: '2026-11-11' }))).toEqual([]);
    expect(dueDayComplete(day({ enabled: false }))).toEqual([]);
    // 식단 끼니가 하나도 없는 날은 기록이 없으면 보낼 기준 시각이 없다
    expect(dueDayComplete(day({ plan: () => ({ planType: 'none' }), record: () => null }))).toEqual(
      [],
    );
  });

  it('never fires before the latest slot in use, even if everything planned is recorded early', () => {
    // 점심만 식단이고 저녁은 자유 끼니: 12:30 에 점심을 적어도 13:30 이 아니라 저녁 시각(19:00)에 간다
    const early = day({
      plan: (_d, slot) => ({ planType: slot === 'lunch' ? 'template' : 'none' }),
      record: on10({ lunch: rec('12:30') }),
    });
    expect(dueDayComplete({ ...early, now: kst('13:30') })).toEqual([]);
    expect(dueDayComplete({ ...early, now: kst('19:00') })).toEqual([
      { targetDate: '2026-11-10', scheduledAt: kst('19:00') },
    ]);
    // 쓰는 끼니가 없으면 기록 1시간 뒤 그대로
    expect(dueDayComplete({ ...early, lastSlotMinute: null, now: kst('13:30') })).toHaveLength(1);
  });

  it('does not retry a failed reminder at the same scheduled time, only after a later edit', () => {
    const failedAt = new Map([['2026-11-10', kst('21:00')]]);
    expect(dueDayComplete(day({ failedAt }))).toEqual([]);
    // 저녁 기록을 20:30 에 고치면 예약 시각이 21:30 으로 가서 다시 보낸다
    const edited = day({
      failedAt,
      now: kst('21:30'),
      record: on10({ lunch: rec('12:10'), dinner: rec('20:30') }),
    });
    expect(dueDayComplete(edited)).toEqual([
      { targetDate: '2026-11-10', scheduledAt: kst('21:30') },
    ]);
  });

  it('still reminds for yesterday when the last meal was recorded just before midnight', () => {
    const out = dueDayComplete(
      day({
        now: kst('00:30', '2026-11-11'),
        record: on10({ lunch: rec('23:30'), dinner: rec('23:30') }),
      }),
    );
    expect(out).toEqual([{ targetDate: '2026-11-10', scheduledAt: kst('00:30', '2026-11-11') }]);
  });

  it('does not remind about yesterday when its record was edited the next day', () => {
    // 11/11 14:00 에 어제(11/10) 점심을 고쳤다 → 15:00 에 '어제' 알림을 보내지 않는다
    const nextDay = { status: 'eaten' as MealStatus, updatedAt: kst('14:00', '2026-11-11') };
    const out = dueDayComplete(
      day({
        now: kst('15:00', '2026-11-11'),
        record: on10({ lunch: nextDay, dinner: rec('20:00') }),
      }),
    );
    expect(out).toEqual([]);
  });
});

describe('stock depletion alert time (DEC-084)', () => {
  it('is scheduled at the set minute (09:00 by default) with the 15 minute grace', () => {
    expect(stockAlertScheduledAt(kst('09:00'), SEOUL, null)).toEqual(kst('09:00'));
    expect(stockAlertScheduledAt(kst('09:15'), SEOUL, null)).toEqual(kst('09:00'));
    expect(stockAlertScheduledAt(kst('08:59'), SEOUL, null)).toBeNull();
    expect(stockAlertScheduledAt(kst('09:16'), SEOUL, null)).toBeNull();
    expect(stockAlertScheduledAt(kst('20:00'), SEOUL, 20 * 60)).toEqual(kst('20:00'));
  });
});
