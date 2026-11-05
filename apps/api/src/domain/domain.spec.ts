import { addDays, eachDate, fromDbDate, isoWeekday, toDbDate } from './dates';
import { allowedUnits, convertQuantity, Decimal, toStockUnit } from './units';
import { computeNutrition, sumNutrition } from './nutrition';
import { PlanResolver } from './plan';

const d = (n: number | string): Decimal => new Decimal(n);

describe('dates', () => {
  it('maps ISO weekday 1=Mon..7=Sun', () => {
    expect(isoWeekday('2026-11-02')).toBe(1); // 월
    expect(isoWeekday('2026-11-08')).toBe(7); // 일
  });
  it('round-trips db dates and adds days across month ends', () => {
    expect(fromDbDate(toDbDate('2026-02-28'))).toBe('2026-02-28');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(eachDate('2026-01-02', '2026-01-01')).toEqual([]);
  });
});

describe('units (D-02, D-11)', () => {
  const pack = { stockUnit: 'ea' as const, packWeightG: d(100) };
  const noPack = { stockUnit: 'ea' as const, packWeightG: null };
  const gram = { stockUnit: 'g' as const, packWeightG: null };

  it('allows g only for ea products with pack weight', () => {
    expect(allowedUnits(pack)).toEqual(['ea', 'g']);
    expect(allowedUnits(noPack)).toEqual(['ea']);
    expect(allowedUnits(gram)).toEqual(['g']);
  });
  it('converts 100g to 0.5 pack and refuses without pack weight', () => {
    expect(toStockUnit(d(50), 'g', pack)?.toString()).toBe('0.5');
    expect(convertQuantity(d(2), 'ea', 'g', pack)?.toString()).toBe('200');
    expect(toStockUnit(d(50), 'g', noPack)).toBeNull();
    expect(convertQuantity(d(1), 'ml', 'g', gram)).toBeNull();
  });
});

describe('nutrition (FR-02 완료 기준)', () => {
  const chicken = { stockUnit: 'ea' as const, packWeightG: d(100) };
  const basis = {
    basisAmount: d(100),
    basisUnit: 'g' as const,
    kcal: d(118),
    carbG: d(0),
    proteinG: d(25),
    fatG: null,
  };

  it('scales by actual quantity, keeps unknown fields null (200g → 236kcal, 50g protein)', () => {
    const n = computeNutrition(basis, d(200), 'g', chicken);
    expect(n.kcal?.toString()).toBe('236');
    expect(n.proteinG?.toString()).toBe('50');
    expect(n.carbG?.toString()).toBe('0');
    expect(n.fatG).toBeNull();
  });
  it('converts packs to grams through pack weight (2 packs = 200g)', () => {
    const n = computeNutrition(basis, d(2), 'ea', chicken);
    expect(n.kcal?.toString()).toBe('236');
  });
  it('is unknown without a version, quantity, or convertible unit', () => {
    expect(computeNutrition(null, d(1), 'ea', chicken).kcal).toBeNull();
    expect(computeNutrition(basis, null, 'ea', chicken).kcal).toBeNull();
    expect(
      computeNutrition(basis, d(1), 'ea', { stockUnit: 'ea', packWeightG: null }).kcal,
    ).toBeNull();
  });
  it('sums only known values and reports incompleteness', () => {
    const t = sumNutrition([
      { kcal: d(100), carbG: d(10), proteinG: null, fatG: d(1) },
      { kcal: null, carbG: null, proteinG: null, fatG: null },
      { kcal: d(50), carbG: d(5), proteinG: d(2), fatG: d(1) },
    ]);
    expect(t.kcal.toString()).toBe('150');
    expect(t.carbG.toString()).toBe('15');
    expect(t.proteinG.toString()).toBe('2');
    expect(t.complete).toBe(false);
    expect(t.missing).toBe(1);
    expect(sumNutrition([]).complete).toBe(true);
  });
});

describe('plan resolution (D-01)', () => {
  const resolver = new PlanResolver(
    [
      { weekday: 1, slot: 'breakfast', planType: 'template', templateId: 't-mon' },
      { weekday: 1, slot: 'dinner', planType: 'outside', templateId: null },
    ],
    [
      {
        id: 'o1',
        onDate: '2026-11-02',
        slot: 'breakfast',
        planType: 'none',
        templateId: null,
        batchId: 'b1',
        note: '출장',
      },
    ],
  );

  it('prefers the date override, then the weekly cell, then no plan', () => {
    expect(resolver.resolve('2026-11-02', 'breakfast')).toMatchObject({
      planType: 'none',
      source: 'override',
      overrideId: 'o1',
      note: '출장',
    });
    expect(resolver.resolve('2026-11-09', 'breakfast')).toMatchObject({
      planType: 'template',
      templateId: 't-mon',
      source: 'weekly',
    });
    expect(resolver.resolve('2026-11-02', 'dinner')).toMatchObject({ planType: 'outside' });
    expect(resolver.resolve('2026-11-03', 'breakfast')).toMatchObject({
      planType: 'none',
      source: 'default',
    });
  });
});
