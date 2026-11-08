/**
 * 통계 (FR-06, FR-07, D-20, DEC-028, DEC-068, 시나리오 6).
 * 7일 기간: 가입 6일 전 → 오늘. 완료 3일(계획대로 / 수량 변경 + 영양 미상 외식 / 안 먹음), 오늘은 미완료.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { addDays } from '../src/domain/dates';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const D = (n: number) => addDays(TODAY, -n);

describe('phase 2: stats', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let chicken: string;

  const eat = (date: string, slot: string, grams: number) =>
    a
      .put(`/meal-records/${date}/${slot}`)
      .send({
        status: 'eaten',
        kind: 'home',
        items: [{ productId: chicken, quantity: grams, unit: 'g' }],
        version: null,
      })
      .expect(200);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    a = api(server, await login(server, 'stats-a', 'A'));
    b = api(server, await login(server, 'stats-b', 'B'));
    // 6일 전에 가입한 것으로 (추적 기간 7일)
    const me = await a.get('/me').expect(200);
    await prisma.user.update({
      where: { id: me.body.id },
      data: { createdAt: new Date(Date.now() - 6 * 86_400_000) },
    });

    chicken = (
      await a
        .post('/products')
        .send({
          name: '닭가슴살',
          stockUnit: 'ea',
          unitLabel: '팩',
          unitsPerPackage: 1,
          packWeightG: 100,
        })
        .expect(201)
    ).body.id;
    await a
      .post(`/products/${chicken}/nutrition`)
      .send({
        basisAmount: 100,
        basisUnit: 'g',
        kcal: 118,
        proteinG: 25,
        carbG: 0,
        fatG: 2,
        source: 'label',
      })
      .expect(201);
    const template = (
      await a
        .post('/meal-templates')
        .send({ name: '닭 200', items: [{ productId: chicken, quantity: 200, unit: 'g' }] })
        .expect(201)
    ).body.id;
    // 매일 아침 = 식단, 나머지는 자유 끼니
    await a
      .put('/plans/weekly')
      .send({
        cells: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          slot: 'breakfast',
          planType: 'template',
          templateId: template,
        })),
      })
      .expect(200);
    await a
      .post('/goals')
      .send({ effectiveFrom: D(6), targetWeightKg: 65, dailyKcal: 1700, proteinG: 120 })
      .expect(201);

    // D-5: 출장 → 아침을 자유 끼니로 사전 변경 (실천율 분모에서 제외)
    await a
      .put(`/plans/overrides/${D(5)}/breakfast`)
      .send({ planType: 'none' })
      .expect(200);
    // D-3: 계획대로 (236 kcal)
    await eat(D(3), 'breakfast', 200);
    // D-2: 수량 변경(118 kcal) + 저녁 식단 외 식사 영양 미상
    await eat(D(2), 'breakfast', 100);
    await a
      .put(`/meal-records/${D(2)}/dinner`)
      .send({ status: 'eaten', kind: 'outside', outsideMenu: '김치찌개', version: null })
      .expect(200);
    // D-1: 아침 안 먹음 (확인된 0)
    await a
      .put(`/meal-records/${D(1)}/breakfast`)
      .send({ status: 'skipped', version: null })
      .expect(200);
    for (const n of [3, 2, 1])
      await a
        .put(`/days/${D(n)}/completion`)
        .send({})
        .expect(200);
    // 오늘: 계획대로 먹었지만 완료 전
    await eat(TODAY, 'breakfast', 200);

    await a
      .put(`/weights/${D(3)}`)
      .send({ weightKg: 70 })
      .expect(200);
    await a
      .put(`/weights/${D(1)}`)
      .send({ weightKg: 69.6 })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('summarizes completion, streak, averages of complete days, goal days and weight (FR-06·07)', async () => {
    const s = (await a.get(`/stats/summary?from=${D(6)}&to=${TODAY}`).expect(200)).body;
    expect(s).toMatchObject({
      from: D(6),
      to: TODAY,
      trackedDays: 7,
      completedDays: 3,
      notCompletedDays: 4,
      currentStreak: 3, // 오늘은 아직 열려 있어 어제부터 센다
    });
    expect(s.completionRate).toBeCloseTo(3 / 7);
    // kcal: D-3 236, D-1 0 (안 먹음은 0), D-2 는 외식 미상이라 제외. 미완료일은 0 으로 넣지 않는다
    expect(s.averages.kcal).toEqual({ average: 118, validDays: 2, unknownDays: 1 });
    expect(s.averages.proteinG).toEqual({ average: 25, validDays: 2, unknownDays: 1 });
    expect(s.goal).toEqual({ achievedDays: 2, eligibleDays: 2 });
    expect(s.weight).toEqual({
      first: { date: D(3), weightKg: 70 },
      last: { date: D(1), weightKg: 69.6 },
      change: -0.4,
      measuredDays: 2,
    });
  });

  it('computes plan adherence by exact match, excluding slots pre-changed to free (DEC-068)', async () => {
    const s = (await a.get(`/stats/summary?from=${D(6)}&to=${TODAY}`).expect(200)).body;
    expect(s.adherence).toEqual({
      plannedSlots: 4, // D-3·D-2·D-1·오늘. D-5 는 자유 끼니로 바꿔 분모 제외
      asPlannedSlots: 2,
      modifiedSlots: 1,
      skippedSlots: 1,
      rate: 0.5,
      overriddenSlots: 0,
      excludedByOverride: 1,
    });
  });

  it('returns the daily series with recorded totals and per-metric completeness', async () => {
    const res = (await a.get(`/stats/daily?from=${D(3)}&to=${addDays(TODAY, 1)}`).expect(200)).body;
    expect(res.days.map((d: { date: string }) => d.date)).toEqual([
      D(3),
      D(2),
      D(1),
      TODAY,
      addDays(TODAY, 1),
    ]);
    const [d3, d2, d1, today, tomorrow] = res.days;
    expect(d3).toMatchObject({
      tracked: true,
      completed: true,
      kcal: 236,
      proteinG: 50,
      goalKcal: 1700,
      weightKg: 70,
    });
    expect(d3.complete).toEqual({ kcal: true, carbG: true, proteinG: true, fatG: true });
    // 외식 영양 미상: 값은 '기록된 합계'(118), 지표는 불완전
    expect(d2).toMatchObject({ completed: true, kcal: 118 });
    expect(d2.complete.kcal).toBe(false);
    expect(d1).toMatchObject({ completed: true, kcal: 0, weightKg: 69.6 });
    expect(today).toMatchObject({ tracked: true, completed: false, kcal: 236 });
    expect(tomorrow).toMatchObject({ tracked: false, completed: false });
  });

  it('recomputes on read: editing a completed day drops it from the averages (D-04)', async () => {
    const rec = await a.get(`/meal-records/${D(1)}/breakfast`).expect(200);
    await a
      .put(`/meal-records/${D(1)}/breakfast`)
      .send({
        status: 'eaten',
        kind: 'home',
        items: [{ productId: chicken, quantity: 200, unit: 'g' }],
        version: rec.body.version,
      })
      .expect(200);
    const s = (await a.get(`/stats/summary?from=${D(6)}&to=${TODAY}`).expect(200)).body;
    expect(s.completedDays).toBe(2);
    expect(s.currentStreak).toBe(0); // 어제 완료가 풀렸다
    expect(s.averages.kcal).toEqual({ average: 236, validDays: 1, unknownDays: 1 });
    await a
      .put(`/days/${D(1)}/completion`)
      .send({})
      .expect(200);
  });

  it('reports no data instead of zero, rejects long ranges, and isolates users (D-06)', async () => {
    const future = (
      await a.get(`/stats/summary?from=${addDays(TODAY, 1)}&to=${addDays(TODAY, 7)}`).expect(200)
    ).body;
    expect(future).toMatchObject({ trackedDays: 0, completionRate: null });
    expect(future.averages.kcal).toEqual({ average: null, validDays: 0, unknownDays: 0 });
    expect(future.adherence.rate).toBeNull();

    await a.get(`/stats/summary?from=${addDays(TODAY, -400)}&to=${TODAY}`).expect(422);
    await a.get(`/stats/summary?from=${TODAY}&to=${D(1)}`).expect(422);
    await a.get('/stats/summary?from=2026-13-01&to=2026-13-02').expect(422);

    const other = (await b.get(`/stats/summary?from=${D(6)}&to=${TODAY}`).expect(200)).body;
    expect(other).toMatchObject({ completedDays: 0, currentStreak: 0 });
    expect(other.adherence.plannedSlots).toBe(0);
    expect(other.weight.measuredDays).toBe(0);
  });
});
