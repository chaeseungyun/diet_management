import type { MealSlot } from '@prisma/client';
import { forecastStock, lowConfidenceProducts, type ForecastProduct } from './forecast';
import { PlanResolver, type OverrideCell, type WeeklyCell } from './plan';
import { Decimal } from './units';

const d = (n: number | string): Decimal => new Decimal(n);
const TODAY = '2026-11-02'; // 월요일
const ALL: MealSlot[] = ['breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'];

/** 매일 같은 끼니에 같은 식단 */
const daily = (slot: MealSlot, templateId: string): WeeklyCell[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, slot, planType: 'template', templateId }));

const override = (onDate: string, slot: MealSlot): OverrideCell => ({
  id: `${onDate}:${slot}`,
  onDate,
  slot,
  planType: 'none',
  templateId: null,
  batchId: null,
  note: null,
});

const chicken = (stock: number | string): ForecastProduct => ({
  id: 'chicken',
  stockUnit: 'ea',
  packWeightG: d(100),
  isStockTracked: true,
  currentStock: d(stock),
});

// 점심 식단: 닭가슴살 1팩, 저녁 식단: 닭가슴살 150g(=1.5팩)
const templateItems = new Map([
  ['lunch-t', [{ productId: 'chicken', quantity: d(1), unit: 'ea' as const }]],
  ['dinner-t', [{ productId: 'chicken', quantity: d(150), unit: 'g' as const }]],
]);

function run(opts: {
  stock: number | string;
  weekly?: WeeklyCell[];
  overrides?: OverrideCell[];
  recordedToday?: MealSlot[];
  activeSlots?: MealSlot[];
  daysBefore?: number;
  product?: ForecastProduct;
}) {
  const product = opts.product ?? chicken(opts.stock);
  const out = forecastStock({
    today: TODAY,
    daysBefore: opts.daysBefore ?? 3,
    activeSlots: opts.activeSlots ?? ALL,
    resolver: new PlanResolver(opts.weekly ?? daily('lunch', 'lunch-t'), opts.overrides ?? []),
    templateItems,
    products: [product],
    recordedToday: new Set(opts.recordedToday ?? []),
  });
  const f = out.get(product.id);
  if (!f) throw new Error('no forecast');
  return f;
}

describe('forecastStock (FR-08, DEC-080)', () => {
  it('depletes on the first meal the remaining amount cannot fully cover', () => {
    // 2.5팩, 하루 1팩: 월·화 먹고 0.5팩 남음 → 수요일 끼니를 못 채운다
    const f = run({ stock: 2.5 });
    expect(f).toMatchObject({ depletionDate: '2026-11-04', daysLeft: 2, level: 'imminent' });
  });

  it('does not deplete when the last meal is covered exactly', () => {
    // 3팩이면 수요일까지 딱 맞고 목요일에 떨어진다
    expect(run({ stock: 3 }).depletionDate).toBe('2026-11-05');
  });

  it('converts g items through pack weight and sums slots of a day', () => {
    // 점심 1팩 + 저녁 150g(1.5팩) = 하루 2.5팩. 4팩 → 월요일 2.5, 화요일 점심 1, 저녁에서 부족
    const f = run({
      stock: 4,
      weekly: [...daily('lunch', 'lunch-t'), ...daily('dinner', 'dinner-t')],
    });
    expect(f.depletionDate).toBe('2026-11-03');
    expect(f.planned[0]).toMatchObject({ date: TODAY });
    expect(f.planned[0]?.quantity.toString()).toBe('2.5');
  });

  it('skips meals already recorded today but keeps unrecorded ones', () => {
    // 오늘 점심을 이미 기록(먹었음이든 안 먹음이든)했으면 내일부터 센다
    expect(run({ stock: 2.5, recordedToday: ['lunch'] }).depletionDate).toBe('2026-11-05');
    expect(run({ stock: 2.5 }).depletionDate).toBe('2026-11-04');
  });

  it('moves the depletion date back when a trip removes planned meals (인수 시나리오 5)', () => {
    const trip = [override('2026-11-03', 'lunch'), override('2026-11-04', 'lunch')];
    expect(run({ stock: 2.5, overrides: trip }).depletionDate).toBe('2026-11-06');
  });

  it('ignores slots the user does not use', () => {
    const f = run({ stock: 2.5, activeSlots: ['breakfast', 'dinner'] });
    expect(f).toMatchObject({ level: 'unpredictable', depletionDate: null, planned: [] });
  });

  it('is ok and beyond the horizon when stock outlasts 60 days', () => {
    const f = run({ stock: 100 });
    expect(f).toMatchObject({ level: 'ok', depletionDate: null, beyondHorizon: true });
    expect(f.planned).toHaveLength(60);
  });

  it('is ok (not imminent) when depletion is further than daysBefore', () => {
    expect(run({ stock: 10 })).toMatchObject({ level: 'ok', depletionDate: '2026-11-12' });
    expect(run({ stock: 10, daysBefore: 10 }).level).toBe('imminent');
  });

  it('picks one badge by priority and never forecasts negative or empty stock (D-21)', () => {
    expect(run({ stock: -1 })).toMatchObject({ level: 'check_needed', depletionDate: null });
    expect(run({ stock: 0 })).toMatchObject({ level: 'depleted', depletionDate: null });
    expect(run({ stock: 5, weekly: [] })).toMatchObject({ level: 'unpredictable' });
    const sauce = { ...chicken(0), id: 'chicken', isStockTracked: false };
    expect(run({ stock: 0, product: sauce })).toMatchObject({ level: 'untracked', planned: [] });
  });

  it('does not count items it cannot convert', () => {
    const noPack = { ...chicken(1), packWeightG: null };
    // 저녁 식단은 g 인데 단위 중량이 없다 → 예정 소비로 세지 않는다
    expect(run({ stock: 1, product: noPack, weekly: daily('dinner', 'dinner-t') }).level).toBe(
      'unpredictable',
    );
  });
});

describe('lowConfidenceProducts (DEC-080 4)', () => {
  const base = {
    today: TODAY,
    activeSlots: ALL,
    resolver: new PlanResolver(daily('lunch', 'lunch-t'), []),
    templateItems,
    from: '2026-10-26',
    weeklyChangedOn: new Map<string, string>(),
  };

  it('flags a product when a planned meal after the baseline is unrecorded', () => {
    const out = lowConfidenceProducts({
      ...base,
      recorded: new Set(['2026-10-30:lunch', '2026-10-31:lunch']),
      baseline: new Map([['chicken', '2026-10-29']]),
    });
    // 11/01 점심이 미기록
    expect([...out]).toEqual(['chicken']);
  });

  it('clears once every planned meal after the baseline is recorded', () => {
    const out = lowConfidenceProducts({
      ...base,
      recorded: new Set(['2026-11-01:lunch']),
      baseline: new Map([['chicken', '2026-10-31']]),
    });
    expect(out.size).toBe(0);
  });

  it('ignores days up to the last change of the weekly cell (the plan back then is unknown)', () => {
    // 2026-11-01 은 일요일(7). 그 칸이 10/31 에 바뀌었으면 11/01 미기록만 남는다
    const input = {
      ...base,
      recorded: new Set<string>(),
      baseline: new Map([['chicken', '2026-10-30']]),
    };
    const cells = (on: string) =>
      new Map([1, 2, 3, 4, 5, 6, 7].map((w) => [`${w}:lunch`, on] as [string, string]));
    expect([...lowConfidenceProducts({ ...input, weeklyChangedOn: cells('2026-10-31') })]).toEqual([
      'chicken',
    ]);
    expect(lowConfidenceProducts({ ...input, weeklyChangedOn: cells('2026-11-01') }).size).toBe(0);
  });

  it('ignores today, the baseline day itself, unused slots and products without movements', () => {
    // 기준일이 어제면 살펴볼 과거가 없다(오늘 미기록은 세지 않는다)
    expect(
      lowConfidenceProducts({
        ...base,
        recorded: new Set(),
        baseline: new Map([['chicken', '2026-11-01']]),
      }).size,
    ).toBe(0);
    expect(
      lowConfidenceProducts({
        ...base,
        activeSlots: ['dinner'],
        recorded: new Set(),
        baseline: new Map([['chicken', '2026-10-01']]),
      }).size,
    ).toBe(0);
    expect(lowConfidenceProducts({ ...base, recorded: new Set(), baseline: new Map() }).size).toBe(
      0,
    );
  });
});
