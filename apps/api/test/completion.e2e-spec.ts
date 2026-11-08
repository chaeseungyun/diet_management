/**
 * 하루 완료 (FR-06, D-04, D-18, D-19, D-20, 상태 전이 §4, 시나리오 6).
 * 완료는 식단 끼니 미기록만 막고, 자유 끼니 미기록은 확인 뒤 '안 먹음' 으로 저장할 수 있다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { addDays, isoWeekday } from '../src/domain/dates';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const WEEKDAY = isoWeekday(TODAY);

describe('phase 2: day completion', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let chicken: string;
  let template: string;

  beforeAll(async () => {
    ({ app } = await createApp());
    server = app.getHttpServer();
    a = api(server, await login(server, 'completion-a', 'A'));

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
    template = (
      await a
        .post('/meal-templates')
        .send({ name: '닭 200', items: [{ productId: chicken, quantity: 200, unit: 'g' }] })
        .expect(201)
    ).body.id;
    // 오늘 요일: 아침·점심은 식단, 나머지는 자유 끼니
    for (const slot of ['breakfast', 'lunch']) {
      await a
        .put(`/plans/weekly/${WEEKDAY}/${slot}`)
        .send({ planType: 'template', templateId: template })
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('excludes future and pre-signup dates from tracking (상태 전이 §4)', async () => {
    const tomorrow = addDays(TODAY, 1);
    const future = await a.get(`/days/${tomorrow}/completion`).expect(200);
    expect(future.body).toMatchObject({ canComplete: false, blocker: 'future', completion: null });
    await a.put(`/days/${tomorrow}/completion`).send({}).expect(422);

    const yesterday = addDays(TODAY, -1); // 사용자는 오늘 가입했다
    const before = await a.get(`/days/${yesterday}/completion`).expect(200);
    expect(before.body.blocker).toBe('before_signup');
    await a.put(`/days/${yesterday}/completion`).send({}).expect(422);
  });

  it('blocks only unrecorded template slots; free slots are listed separately (D-18, D-19)', async () => {
    const check = await a.get(`/days/${TODAY}/completion`).expect(200);
    expect(check.body).toMatchObject({
      canComplete: false,
      blocker: 'unrecorded',
      unrecorded: ['breakfast', 'lunch'],
      unrecordedFree: ['afternoon_snack', 'dinner', 'evening_snack'],
      nutritionComplete: true, // 아직 기록이 없으니 미상도 없다
      missing: 0,
    });
    expect(check.body.slots).toHaveLength(5);
    expect(check.body.slots[0]).toMatchObject({
      slot: 'breakfast',
      planType: 'template',
      counted: true,
    });
    expect(check.body.slots[2]).toMatchObject({
      slot: 'afternoon_snack',
      planType: 'none',
      counted: false,
    });
    await a.put(`/days/${TODAY}/completion`).send({}).expect(422);

    // S-10 도 같은 판정을 받는다
    const day = await a.get(`/days/${TODAY}`).expect(200);
    expect(day.body.completionCheck).toMatchObject({ canComplete: false, blocker: 'unrecorded' });
  });

  it('completes once template slots are eaten/skipped, saving free slots as skipped on request', async () => {
    await a
      .put(`/meal-records/${TODAY}/breakfast`)
      .send({
        status: 'eaten',
        kind: 'home',
        items: [{ productId: chicken, quantity: 200, unit: 'g' }],
        version: null,
      })
      .expect(200);
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'skipped', version: null })
      .expect(200);

    const check = await a.get(`/days/${TODAY}/completion`).expect(200);
    expect(check.body).toMatchObject({
      canComplete: true,
      blocker: null,
      unrecorded: [],
      unrecordedFree: ['afternoon_snack', 'dinner', 'evening_snack'],
      nutritionComplete: true,
    });

    const done = await a
      .put(`/days/${TODAY}/completion`)
      .send({ skipUnrecordedFree: true })
      .expect(200);
    expect(done.body.nutritionComplete).toBe(true);
    expect(typeof done.body.completedAt).toBe('string');

    // 자유 끼니 3개가 '안 먹음' 으로 저장됐고 집계에 들어간다
    const day = await a.get(`/days/${TODAY}`).expect(200);
    expect(day.body.slots.map((s: { slot: string; status: string }) => [s.slot, s.status])).toEqual(
      [
        ['breakfast', 'eaten'],
        ['lunch', 'skipped'],
        ['afternoon_snack', 'skipped'],
        ['dinner', 'skipped'],
        ['evening_snack', 'skipped'],
      ],
    );
    expect(day.body.completion).not.toBeNull();
    expect(day.body.completionCheck.unrecordedFree).toEqual([]);
    expect(day.body.nutrition.recorded.kcal).toBe(236);
    const summary = (await a.get(`/days?from=${TODAY}&to=${TODAY}`).expect(200)).body[0];
    expect(summary).toMatchObject({
      completed: true,
      activeSlots: 5,
      recordedSlots: 5,
      unrecordedCount: 0,
    });

    // 재완료는 멱등: 시각 유지
    const again = await a.put(`/days/${TODAY}/completion`).send({}).expect(200);
    expect(again.body.completedAt).toBe(done.body.completedAt);
  });

  it('clears completion when a recorded meal changes (D-04), records nutrition-incomplete days (scenario 6)', async () => {
    const dinner = await a.get(`/meal-records/${TODAY}/dinner`).expect(200);
    // 저녁을 식단 외 식사(영양 미상)로 수정 → 완료 해제
    const edited = await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send({
        status: 'eaten',
        kind: 'outside',
        outsideMenu: '김치찌개',
        version: dinner.body.version,
      })
      .expect(200);
    expect(edited.body.completionCleared).toBe(true);

    let check = await a.get(`/days/${TODAY}/completion`).expect(200);
    expect(check.body).toMatchObject({
      completion: null,
      canComplete: true,
      nutritionComplete: false,
      missing: 1,
    });
    const summary = (await a.get(`/days?from=${TODAY}&to=${TODAY}`).expect(200)).body[0];
    expect(summary.completed).toBe(false);

    // 영양 미상이어도 완료는 가능하고 '영양 불완전' 으로 저장된다 (시나리오 6)
    const done = await a.put(`/days/${TODAY}/completion`).send({}).expect(200);
    expect(done.body.nutritionComplete).toBe(false);

    // 완료 해제는 멱등
    await a.delete(`/days/${TODAY}/completion`).expect(204);
    await a.delete(`/days/${TODAY}/completion`).expect(204);
    check = await a.get(`/days/${TODAY}/completion`).expect(200);
    expect(check.body.completion).toBeNull();
  });

  it('completes with an unrecorded free slot left as is (D-18: 미기록 자유 끼니는 집계 제외)', async () => {
    const snack = await a.get(`/meal-records/${TODAY}/afternoon_snack`).expect(200);
    await a
      .put(`/meal-records/${TODAY}/afternoon_snack`)
      .send({ status: 'unrecorded', version: snack.body.version })
      .expect(200);
    const check = await a.get(`/days/${TODAY}/completion`).expect(200);
    expect(check.body).toMatchObject({ canComplete: true, unrecordedFree: ['afternoon_snack'] });
    await a.put(`/days/${TODAY}/completion`).send({}).expect(200);
    const day = await a.get(`/days/${TODAY}`).expect(200);
    expect(day.body.slots.find((s: { slot: string }) => s.slot === 'afternoon_snack').status).toBe(
      'unrecorded',
    );
    const summary = (await a.get(`/days?from=${TODAY}&to=${TODAY}`).expect(200)).body[0];
    expect(summary).toMatchObject({ completed: true, activeSlots: 4, recordedSlots: 4 });
  });
});
