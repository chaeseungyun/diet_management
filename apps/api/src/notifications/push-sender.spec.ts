import { classify } from './push-sender';
import { dayCompletePayload, mealPayload, stockPayload } from './notification-scheduler';

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

describe('dayCompletePayload · stockPayload (DEC-084)', () => {
  it('links the day-complete reminder to that day', () => {
    expect(dayCompletePayload('2026-11-10', '2026-11-10')).toEqual({
      title: '오늘 끼니를 모두 기록했어요',
      body: '하루 완료를 눌러 마무리해 주세요',
      url: '/day/2026-11-10',
      tag: 'day-complete-2026-11-10',
    });
    expect(dayCompletePayload('2026-11-09', '2026-11-10').title).toBe(
      '어제 끼니를 모두 기록했어요',
    );
  });

  it('links one product to its screen and a bundle to the product list', () => {
    const item = (productId: string, name: string, daysLeft: number) => ({
      productId,
      name,
      depletionDate: '2026-11-12',
      daysLeft,
    });
    expect(stockPayload([item('p1', '닭가슴살', 2)], '2026-11-10')).toEqual({
      title: '닭가슴살 곧 떨어져요',
      body: '11월 12일(2일 뒤)에 떨어져요 · 눌러서 확인하기',
      url: '/products/p1',
      tag: 'stock-2026-11-10',
    });
    const many = stockPayload(
      [
        item('p1', '닭가슴살', 0),
        item('p2', '달걀', 1),
        item('p3', '현미밥', 2),
        item('p4', '두부', 3),
      ],
      '2026-11-10',
    );
    expect(many).toEqual({
      title: '닭가슴살 외 3개가 곧 떨어져요',
      body: '닭가슴살, 달걀, 현미밥 등 · 눌러서 확인하기',
      url: '/products',
      tag: 'stock-2026-11-10',
    });
  });
});
