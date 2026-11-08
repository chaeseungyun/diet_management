import { Decimal } from './units';
import { currentStreak, dayNutrition, isAsPlanned, summarize, type StatsDay } from './stats';
import type { NutritionValues } from './nutrition';

const d = (n: number | null) => (n === null ? null : new Decimal(n));
const part = (kcal: number | null, protein: number | null = 0): NutritionValues => ({
  kcal: d(kcal),
  carbG: d(0),
  proteinG: d(protein),
  fatG: d(0),
});

function day(over: Partial<StatsDay> & { date: string }, parts: NutritionValues[] = []): StatsDay {
  return {
    tracked: true,
    completed: true,
    goalKcal: 1700,
    weightKg: null,
    nutrition: dayNutrition(parts),
    ...over,
  };
}

describe('stats', () => {
  it('sums known values per metric and marks unknown metrics incomplete', () => {
    const n = dayNutrition([part(300, 20), part(null, 10), part(200, null)]);
    expect(n.values.kcal.toNumber()).toBe(500);
    expect(n.complete.kcal).toBe(false);
    expect(n.values.proteinG.toNumber()).toBe(30);
    expect(n.complete.proteinG).toBe(false);
    expect(n.complete.carbG).toBe(true);
    // 안 먹음(품목 없음) 은 확인된 0
    expect(dayNutrition([]).complete.kcal).toBe(true);
  });

  it('averages only completed days with the metric known; zero valid days is no data (FR-06)', () => {
    const s = summarize([
      day({ date: '2026-11-01' }, [part(1500, 100)]),
      day({ date: '2026-11-02' }, [part(1800, 120)]),
      day({ date: '2026-11-03' }, [part(null, 90)]), // 외식 영양 미상: kcal 평균에서 제외
      day({ date: '2026-11-04', completed: false }, [part(600)]), // 미완료: 0kcal 로 넣지 않음
      day({ date: '2026-11-05', tracked: false, completed: false }), // 미래
    ]);
    expect(s).toMatchObject({
      trackedDays: 4,
      completedDays: 3,
      completionRate: 0.75,
      notCompletedDays: 1,
    });
    expect(s.averages.kcal).toEqual({ average: 1650, validDays: 2, unknownDays: 1 });
    expect(s.averages.proteinG).toEqual({ average: 103.3, validDays: 3, unknownDays: 0 });
    expect(s.goal).toEqual({ achievedDays: 1, eligibleDays: 2 });

    const empty = summarize([day({ date: '2026-11-01', completed: false })]);
    expect(empty.averages.kcal.average).toBeNull();
    expect(empty.completionRate).toBe(0);
    expect(summarize([]).completionRate).toBeNull();
  });

  it('summarizes weight from first to last measurement, never filling gaps', () => {
    const s = summarize([
      day({ date: '2026-11-01', weightKg: 70.4 }),
      day({ date: '2026-11-02' }),
      day({ date: '2026-11-03', weightKg: 69.9 }),
    ]);
    expect(s.weight).toEqual({
      first: { date: '2026-11-01', weightKg: 70.4 },
      last: { date: '2026-11-03', weightKg: 69.9 },
      change: -0.5,
      measuredDays: 2,
    });
    expect(summarize([day({ date: '2026-11-01', weightKg: 70 })]).weight.change).toBeNull();
  });

  it('counts the streak from today, or from yesterday when today is still open', () => {
    const done = new Set(['2026-11-05', '2026-11-06', '2026-11-07']);
    expect(currentStreak(done, '2026-11-07', '2026-11-01')).toBe(3);
    expect(currentStreak(done, '2026-11-08', '2026-11-01')).toBe(3);
    expect(currentStreak(done, '2026-11-09', '2026-11-01')).toBe(0);
    expect(currentStreak(done, '2026-11-07', '2026-11-06')).toBe(2); // 가입 전은 세지 않음
  });

  it('judges as-planned by exact quantity match on every item', () => {
    const it = (p: number | null, a: number | null) => ({
      plannedQuantity: d(p),
      actualQuantity: d(a),
    });
    expect(isAsPlanned('eaten', 'home', [it(200, 200), it(15, 15)])).toBe(true);
    expect(isAsPlanned('eaten', 'home', [it(200, 100)])).toBe(false);
    expect(isAsPlanned('eaten', 'home', [it(200, 200), it(null, 30)])).toBe(false); // 식단에 없던 품목
    expect(isAsPlanned('eaten', 'outside', [it(200, 200)])).toBe(false);
    expect(isAsPlanned('skipped', 'home', [])).toBe(false);
  });
});
