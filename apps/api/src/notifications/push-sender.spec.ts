import { classify } from './push-sender';
import { mealPayload } from './notification-scheduler';

describe('classify (DEC-075)', () => {
  it.each([
    [201, 'ok'],
    [404, 'gone'],
    [410, 'gone'],
    [429, 'transient'],
    [500, 'transient'],
    [503, 'transient'],
    [null, 'transient'], // 네트워크 오류
    [400, 'permanent'],
    [403, 'permanent'], // VAPID 키 문제 — 구독은 지우지 않는다
    [413, 'permanent'],
  ])('%s → %s', (status, kind) => {
    expect(classify(status, 'msg').kind).toBe(kind);
  });
});

describe('mealPayload', () => {
  it('links to the meal screen and shares a tag between the reminder and its repeats', () => {
    const first = mealPayload(
      { type: 'meal_check', targetDate: '2026-11-10', slot: 'lunch' },
      '닭 200',
    );
    const again = mealPayload(
      { type: 'unrecorded_remind', targetDate: '2026-11-10', slot: 'lunch' },
      undefined,
    );
    expect(first).toEqual({
      title: '점심 기록할 시간이에요',
      body: '닭 200 · 눌러서 기록하기',
      url: '/day/2026-11-10/lunch',
      tag: 'meal-2026-11-10-lunch',
    });
    expect(again.title).toBe('점심 아직 기록 전이에요');
    expect(again.body).toBe('오늘 식단 · 눌러서 기록하기');
    expect(again.tag).toBe(first.tag);
  });
});
