/**
 * 단계 1 인수 테스트 (requirements §4 시나리오 1·2·3·4·5·7, D-03, D-04, D-08, D-10, D-13).
 * 실제 PostgreSQL 위에서 돈다. 숫자는 요구사항 본문의 예시를 그대로 쓴다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { addDays, isoWeekday } from '../src/domain/dates';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');
const WEEKDAY = isoWeekday(TODAY);
const YESTERDAY = addDays(TODAY, -1);

describe('phase 1: products, nutrition, plans, records, stock ledger', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;

  // 사용자 A 의 데이터
  let chicken: string; // ea, 1팩 = 100g
  let protein: string; // g, 1통 = 1000g
  let eggs: string; // ea, 30개 한 판, 단위 중량 없음
  let sauce: string; // 재고 비관리
  let template: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'p1-a', 'A'));
    b = api(server, await login(server, 'p1-b', 'B'));
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- 시나리오 1: 영양 없이 제품 4개 등록 ----------

  it('registers products without nutrition and reports stock and missing nutrition (scenario 1)', async () => {
    const c = await a
      .post('/products')
      .send({
        name: '닭가슴살',
        stockUnit: 'ea',
        unitLabel: '팩',
        unitsPerPackage: 1,
        packWeightG: 100,
      })
      .expect(201);
    chicken = c.body.id;
    expect(c.body).toMatchObject({
      nutrition: null,
      currentStock: 0,
      allowedUnits: ['ea', 'g'],
      unitLabel: '팩',
    });

    const p = await a
      .post('/products')
      .send({ name: '프로틴', stockUnit: 'g', unitsPerPackage: 1000, initialStock: 1000 })
      .expect(201);
    protein = p.body.id;
    expect(p.body.currentStock).toBe(1000);
    expect(p.body.allowedUnits).toEqual(['g']);

    const e = await a
      .post('/products')
      .send({ name: '구운란', stockUnit: 'ea', unitLabel: '개', unitsPerPackage: 30 })
      .expect(201);
    eggs = e.body.id;
    expect(e.body.allowedUnits).toEqual(['ea']); // 단위 중량 없음 → g 입력 불가 (D-02)

    const s = await a
      .post('/products')
      .send({ name: '소스', stockUnit: 'g', isStockTracked: false, defaultServingAmount: 15 })
      .expect(201);
    sauce = s.body.id;
    expect(s.body.currentStock).toBeNull();

    const list = await a.get('/products').expect(200);
    expect(list.body).toHaveLength(4);
    expect(list.body.every((x: { nutrition: unknown }) => x.nutrition === null)).toBe(true);
  });

  it('validates the unit model (D-11)', async () => {
    await a.post('/products').send({ name: 'x', stockUnit: 'ea' }).expect(422); // unitLabel 필수
    await a.post('/products').send({ name: 'x', stockUnit: 'g', packWeightG: 10 }).expect(422);
    await a.post('/products').send({ name: 'x', stockUnit: 'kg' }).expect(422);
    await a
      .post('/products')
      .send({ name: 'x', stockUnit: 'g', isStockTracked: false, initialStock: 3 })
      .expect(422);
  });

  // ---------- 시나리오 2: 영양 입력 → 200g = 236kcal·단백질 50g ----------

  it('computes template nutrition from the product basis (scenario 2, FR-02 완료 기준)', async () => {
    await a
      .post(`/products/${chicken}/nutrition`)
      .send({ basisAmount: 100, basisUnit: 'ml', kcal: 1, source: 'label' })
      .expect(422); // D-11: ea 제품은 ea 또는 g 만

    const saved = await a
      .post(`/products/${chicken}/nutrition`)
      .send({
        basisAmount: 100,
        basisUnit: 'g',
        kcal: 118,
        proteinG: 25,
        carbG: 0,
        source: 'label',
      })
      .expect(201);
    expect(saved.body.unknownSnapshotCount).toBe(0);
    expect(saved.body.version.fatG).toBeNull();

    const t = await a
      .post('/meal-templates')
      .send({
        name: '점심',
        items: [
          { productId: chicken, quantity: 200, unit: 'g' },
          { productId: sauce, quantity: 15, unit: 'g' },
        ],
      })
      .expect(201);
    template = t.body.id;
    const chickenItem = t.body.items.find((i: { productId: string }) => i.productId === chicken);
    expect(chickenItem.nutrition).toMatchObject({ kcal: 236, proteinG: 50, carbG: 0, fatG: null });
    expect(t.body.nutrition).toMatchObject({
      kcal: 236,
      proteinG: 50,
      complete: false,
      missing: 1,
    });

    // 프로틴 45g 배정 → 45g 기준 영양만, 단백질 45g 이 아니다
    await a
      .post(`/products/${protein}/nutrition`)
      .send({ basisAmount: 30, basisUnit: 'g', kcal: 120, proteinG: 24, source: 'label' })
      .expect(201);
    const t2 = await a
      .post('/meal-templates')
      .send({ name: '프로틴', items: [{ productId: protein, quantity: 45, unit: 'g' }] })
      .expect(201);
    expect(t2.body.items[0].nutrition).toMatchObject({ kcal: 180, proteinG: 36 });

    // 단위 중량 없는 ea 제품에 g 는 거부 (D-02)
    await a
      .post('/meal-templates')
      .send({ name: 'x', items: [{ productId: eggs, quantity: 50, unit: 'g' }] })
      .expect(422);
  });

  // ---------- 시나리오 3: 30팩 → 28 → 29 → 30 ----------

  it('deducts on eaten, re-deducts on edit, restores on cancel (scenario 3, D-04)', async () => {
    await a
      .post('/stock-receipts')
      .send({ productId: chicken, quantity: 30, note: '기존 보유' })
      .expect(201);
    await a
      .put(`/plans/weekly/${WEEKDAY}/lunch`)
      .send({ planType: 'template', templateId: template })
      .expect(200);

    const planned = await a.get(`/meal-records/${TODAY}/lunch`).expect(200);
    expect(planned.body).toMatchObject({
      id: null,
      status: 'unrecorded',
      version: null,
      planType: 'template',
      templateName: '점심',
    });
    expect(planned.body.items[0]).toMatchObject({
      plannedQuantity: 200,
      unit: 'g',
      actualQuantity: null,
    });

    const stock = async () => (await a.get(`/products/${chicken}`).expect(200)).body.currentStock;
    expect(await stock()).toBe(30);

    const eaten = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 2, unit: 'ea' }],
        version: null,
      })
      .expect(200);
    expect(eaten.body).toMatchObject({ status: 'eaten', version: 0, stockCheckNeeded: false });
    expect(eaten.body.items[0]).toMatchObject({ actualQuantity: 2, plannedQuantity: 2 }); // 200g = 2팩
    expect(eaten.body.nutrition).toMatchObject({ kcal: 236, proteinG: 50, complete: true });
    expect(await stock()).toBe(28);

    const edited = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 1, unit: 'ea' }],
        version: 0,
      })
      .expect(200);
    expect(edited.body.version).toBe(1);
    expect(await stock()).toBe(29);

    const cancelled = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'unrecorded', version: 1 })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'unrecorded', version: 2 });
    expect(cancelled.body.items[0]).toMatchObject({ id: null, plannedQuantity: 200 }); // 계획으로 복귀
    expect(await stock()).toBe(30);

    const movements = await prisma.stockMovement.findMany({
      where: { productId: chicken },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => `${m.reason}:${m.delta.toString()}`)).toEqual([
      'initial:30',
      'consume:-2',
      'consume_reverse:2',
      'consume:-1',
      'consume_reverse:1',
    ]);
  });

  it('converts grams to packs through pack weight and flags negative stock without blocking', async () => {
    const r = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 150, unit: 'g' }],
        version: 2,
      })
      .expect(200);
    expect(r.body.items[0].nutrition.kcal).toBe(177);
    const p = await a.get(`/products/${chicken}`).expect(200);
    expect(p.body.currentStock).toBe(28.5); // 150g = 1.5팩 (D-02)

    const big = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 40, unit: 'ea' }],
        version: 3,
      })
      .expect(200);
    expect(big.body.stockCheckNeeded).toBe(true);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(-10); // 0 으로 자르지 않는다

    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({ status: 'unrecorded', version: 4 })
      .expect(200);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(30);
  });

  it('refuses stockUnit changes once movements exist (D-13) and allows other fields', async () => {
    await a.patch(`/products/${chicken}`).send({ stockUnit: 'g' }).expect(422);
    const ok = await a
      .patch(`/products/${chicken}`)
      .send({ brand: '브랜드', purchaseUrl: 'https://shop.example/x' })
      .expect(200);
    expect(ok.body.brand).toBe('브랜드');
    // 템플릿이 g 로 쓰는 제품의 단위 중량 제거는 거부
    await a.patch(`/products/${chicken}`).send({ packWeightG: null }).expect(422);
  });

  // ---------- 시나리오 4: 중복 요청·재전송·동시 수정 ----------

  it('replays the same Idempotency-Key without a second deduction, rejects a different body (scenario 4)', async () => {
    const body = {
      status: 'eaten',
      items: [{ productId: chicken, quantity: 2, unit: 'ea' }],
      version: 5,
    };
    const first = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(200);
    const replay = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(200);
    expect(replay.body).toEqual(first.body);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(28);

    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .set('Idempotency-Key', 'k-1')
      .send({ ...body, items: [{ productId: chicken, quantity: 3, unit: 'ea' }] })
      .expect(422);

    // 키 없이 같은 version 재전송은 409 (이미 6 으로 올라감)
    await a.put(`/meal-records/${TODAY}/lunch`).send(body).expect(409);
  });

  it('serializes concurrent writes: same key → one deduction, stale version → 409', async () => {
    const current = (await a.get(`/meal-records/${TODAY}/lunch`)).body.version as number;
    const body = {
      status: 'eaten',
      items: [{ productId: chicken, quantity: 1, unit: 'ea' }],
      version: current,
    };
    const [r1, r2] = await Promise.all([
      a.put(`/meal-records/${TODAY}/lunch`).set('Idempotency-Key', 'k-par').send(body),
      a.put(`/meal-records/${TODAY}/lunch`).set('Idempotency-Key', 'k-par').send(body),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body).toEqual(r2.body);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(29);

    const stale = { ...body, items: [{ productId: chicken, quantity: 3, unit: 'ea' }] };
    const [s1, s2] = await Promise.all([
      a.put(`/meal-records/${TODAY}/lunch`).send({ ...stale, version: current + 1 }),
      a.put(`/meal-records/${TODAY}/lunch`).send({ ...stale, version: current + 1 }),
    ]);
    expect([s1.status, s2.status].sort()).toEqual([200, 409]);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(27);
  });

  // ---------- 시나리오 5: 출장 외부 식사 → 예정 소비만 감소, 과거 기록 유지 ----------

  it('batch overrides change only the plan; recorded meals stay (scenario 5, FR-04)', async () => {
    const from = addDays(TODAY, 1);
    const to = addDays(TODAY, 3);
    for (let d = 1; d <= 3; d += 1) {
      await a
        .put(`/plans/weekly/${isoWeekday(addDays(TODAY, d))}/dinner`)
        .send({ planType: 'template', templateId: template })
        .expect(200);
    }
    const batch = await a
      .post('/plans/overrides/batch')
      .send({ from, to, slots: ['dinner'], planType: 'outside', note: '출장' })
      .expect(201);
    expect(batch.body.count).toBe(3);

    const resolved = await a.get(`/plans/resolved?from=${from}&to=${to}`).expect(200);
    const dinners = resolved.body.filter((r: { slot: string }) => r.slot === 'dinner');
    expect(
      dinners.every(
        (r: { planType: string; source: string }) =>
          r.planType === 'outside' && r.source === 'override',
      ),
    ).toBe(true);
    const lunches = resolved.body.filter(
      (r: { slot: string; date: string }) => r.slot === 'lunch' && isoWeekday(r.date) === WEEKDAY,
    );
    expect(lunches.every((r: { planType: string }) => r.planType === 'template')).toBe(true);

    // 오늘 점심 기록은 그대로
    const lunch = await a.get(`/meal-records/${TODAY}/lunch`).expect(200);
    expect(lunch.body.status).toBe('eaten');

    const days = await a.get(`/days?from=${TODAY}&to=${to}`).expect(200);
    expect(days.body).toHaveLength(4);
    expect(days.body[1]).toMatchObject({
      hasOverride: true,
      hasOutside: true,
      unrecordedCount: null,
    });

    await a.delete(`/plans/overrides/batch/${batch.body.batchId}`).expect(204);
    const after = await a.get(`/plans/resolved?from=${from}&to=${to}`).expect(200);
    expect(
      after.body
        .filter((r: { slot: string }) => r.slot === 'dinner')
        .every((r: { planType: string }) => r.planType === 'template'),
    ).toBe(true);
    await a.delete(`/plans/overrides/batch/${batch.body.batchId}`).expect(404);
  });

  // ---------- 외부 식사·추가 간식·영양 미상 보완 (D-03, D-10) ----------

  it('records an outside meal with unknown nutrition and adds extras that deduct stock (D-10)', async () => {
    await a
      .put(`/meal-records/${YESTERDAY}/dinner`)
      .send({ status: 'eaten', kind: 'outside', version: null })
      .expect(422); // 메뉴명 필수
    const outside = await a
      .put(`/meal-records/${YESTERDAY}/dinner`)
      .send({ status: 'eaten', kind: 'outside', outsideMenu: '김치찌개', version: null })
      .expect(200);
    expect(outside.body.nutrition).toMatchObject({ complete: false, missing: 1, kcal: 0 });

    const before = (await a.get(`/products/${chicken}`)).body.currentStock;
    const extra = await a
      .post(`/meal-records/${YESTERDAY}/extra`)
      .send({ status: 'eaten', items: [{ productId: chicken, quantity: 1, unit: 'ea' }] })
      .expect(201);
    expect(extra.body).toMatchObject({ slot: 'extra', version: 0 });
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(before - 1);

    const day = await a.get(`/days/${YESTERDAY}`).expect(200);
    expect(day.body.extras).toHaveLength(1);
    expect(day.body.nutrition.recorded).toMatchObject({ kcal: 118, complete: false, missing: 1 });
    expect(day.body.isToday).toBe(false);

    await a.delete(`/meal-records/${YESTERDAY}/extra/${extra.body.id}`).expect(204);
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(before);
    await a.delete(`/meal-records/${YESTERDAY}/extra/${extra.body.id}`).expect(404);
  });

  it('backfills only unknown snapshots after nutrition is registered (D-03 two-step)', async () => {
    // 구운란은 영양 미등록 → 먹은 스냅샷의 kcal 은 미상
    await a.post('/stock-receipts').send({ productId: eggs, quantity: 30 }).expect(201);
    const eaten = await a
      .put(`/meal-records/${YESTERDAY}/breakfast`)
      .send({
        status: 'eaten',
        items: [{ productId: eggs, quantity: 2, unit: 'ea' }],
        version: null,
      })
      .expect(200);
    expect(eaten.body.items[0]).toMatchObject({
      nutrition: { kcal: null },
      nutritionRegistered: false,
    });

    const saved = await a
      .post(`/products/${eggs}/nutrition`)
      .send({ basisAmount: 1, basisUnit: 'ea', kcal: 70, proteinG: 6, source: 'label' })
      .expect(201);
    expect(saved.body.unknownSnapshotCount).toBe(1);

    // 과거 스냅샷은 저장만으로는 바뀌지 않는다 (NFR-02)
    const still = await a.get(`/meal-records/${YESTERDAY}/breakfast`).expect(200);
    expect(still.body.items[0].nutrition.kcal).toBeNull();

    const back = await a.post(`/products/${eggs}/nutrition/backfill`).expect(200);
    expect(back.body).toEqual({ updated: 1, skipped: 0 });
    const filled = await a.get(`/meal-records/${YESTERDAY}/breakfast`).expect(200);
    expect(filled.body.items[0]).toMatchObject({
      nutrition: { kcal: 140, proteinG: 12 },
      nutritionSource: 'backfill',
    });
    expect(filled.body.items[0].backfilledAt).toEqual(expect.any(String));

    // 새 버전을 올려도 값이 있는 스냅샷은 손대지 않는다
    await a
      .post(`/products/${eggs}/nutrition`)
      .send({ basisAmount: 1, basisUnit: 'ea', kcal: 75, source: 'label' })
      .expect(201);
    expect((await a.post(`/products/${eggs}/nutrition/backfill`)).body.updated).toBe(0);
    expect((await a.get(`/meal-records/${YESTERDAY}/breakfast`)).body.items[0].nutrition.kcal).toBe(
      140,
    );
  });

  // ---------- 구매·입고, 목표·체중, 오늘 화면 ----------

  it('keeps ordered purchases out of stock until received (FR-03, D-11)', async () => {
    const order = await a
      .post('/purchases')
      .set('Idempotency-Key', 'buy-1')
      .send({ productId: protein, quantity: 2, purchasedOn: TODAY, price: 59000 })
      .expect(201);
    expect(order.body).toMatchObject({ status: 'ordered', defaultReceiveQuantity: 2000 });
    const before = await a.get(`/products/${protein}`).expect(200);
    expect(before.body).toMatchObject({ currentStock: 1000, orderedQuantity: 2000 });

    const replay = await a
      .post('/purchases')
      .set('Idempotency-Key', 'buy-1')
      .send({ productId: protein, quantity: 2, purchasedOn: TODAY, price: 59000 })
      .expect(201);
    expect(replay.body.id).toBe(order.body.id);
    expect(await prisma.purchase.count({ where: { productId: protein } })).toBe(1);

    const received = await a
      .post(`/purchases/${order.body.id}/receive`)
      .send({ quantity: 1900 })
      .expect(200);
    expect(received.body).toMatchObject({ status: 'received', receipt: { quantity: 1900 } });
    const after = await a.get(`/products/${protein}`).expect(200);
    expect(after.body).toMatchObject({ currentStock: 2900, orderedQuantity: 0 });

    await a.post(`/purchases/${order.body.id}/cancel`).expect(422);
    await a.patch(`/purchases/${order.body.id}`).send({ quantity: 3 }).expect(422);
    const list = await a.get('/purchases?status=received').expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('stores goals as history and weights with overwrite confirmation (FR-01, FR-07)', async () => {
    const g1 = await a
      .post('/goals')
      .send({
        effectiveFrom: addDays(TODAY, -30),
        targetWeightKg: 70,
        dailyKcal: 1800,
        proteinG: 140,
      })
      .expect(201);
    const g2 = await a
      .post('/goals')
      .send({ targetWeightKg: 68, dailyKcal: 1700, proteinG: 150, carbG: 150 })
      .expect(201);
    expect(g1.body.current).toBe(true); // 생성 시점에는 유일한 목표
    expect(g2.body.current).toBe(true);
    const old = await a.get(`/goals/effective?date=${addDays(TODAY, -10)}`).expect(200);
    expect(old.body.goal.dailyKcal).toBe(1800);
    const list = await a.get('/goals').expect(200);
    expect(list.body.map((g: { current: boolean }) => g.current)).toEqual([true, false]);

    await a.put(`/weights/${YESTERDAY}`).send({ weightKg: 75 }).expect(200);
    await a.put(`/weights/${YESTERDAY}`).send({ weightKg: 74.5 }).expect(409);
    await a.put(`/weights/${YESTERDAY}`).send({ weightKg: 74.5, overwrite: true }).expect(200);
    await a
      .put(`/weights/${addDays(TODAY, 1)}`)
      .send({ weightKg: 74 })
      .expect(422);
    await a
      .put(`/weights/${addDays(TODAY, -8)}`)
      .send({ weightKg: 76 })
      .expect(200);
    const w = await a.get('/weights').expect(200);
    expect(w.body.summary).toMatchObject({
      last7Count: 1,
      last7Avg: 74.5,
      targetWeightKg: 68,
      diffToTarget: 6.5,
      weekChange: -1.5,
      monthChange: null,
    });
    await a.delete(`/weights/${YESTERDAY}`).expect(204);
    await a.delete(`/weights/${YESTERDAY}`).expect(404);
  });

  it('assembles the day view with recorded vs expected totals and the next slot (S-10)', async () => {
    await a
      .put(`/plans/weekly/${WEEKDAY}/breakfast`)
      .send({ planType: 'template', templateId: template })
      .expect(200);
    const day = await a.get(`/days/${TODAY}`).expect(200);
    expect(day.body.isToday).toBe(true);
    expect(day.body.slots.map((s: { slot: string }) => s.slot)).toEqual([
      'breakfast',
      'lunch',
      'afternoon_snack',
      'dinner',
      'evening_snack',
    ]);
    const breakfast = day.body.slots[0];
    expect(breakfast).toMatchObject({ status: 'unrecorded', planType: 'template', version: null });
    expect(day.body.nextSlot).toBe('breakfast');
    expect(day.body.nutrition.goal.dailyKcal).toBe(1700);
    // 점심(3팩 = 354kcal)은 기록됨, 아침(236)은 예상에만
    expect(day.body.nutrition.recorded.kcal).toBe(354);
    expect(day.body.nutrition.expected.kcal).toBe(590);
    expect(day.body.nutrition.expected.complete).toBe(false); // 소스 영양 미등록
  });

  it('skipped keeps planned items visible and empty eaten home meal is rejected (DEC-057)', async () => {
    const date = addDays(TODAY, 7); // 같은 요일 → 점심 템플릿이 배정돼 있다
    const before = await a.get(`/meal-records/${date}/lunch`).expect(200);
    expect(before.body.status).toBe('unrecorded');
    expect(before.body.items.length).toBeGreaterThan(0);

    // 먹었음(계획 품목) → 안 먹음: 안 먹음도 미기록과 같이 뺀 양을 전부 되돌린다
    const stock = async () => (await a.get(`/products/${chicken}`).expect(200)).body.currentStock;
    const stockBefore = await stock();
    const eaten = await a
      .put(`/meal-records/${date}/lunch`)
      .send({
        status: 'eaten',
        kind: 'home',
        items: before.body.items.map(
          (i: { productId: string; plannedQuantity: number; unit: string }) => ({
            productId: i.productId,
            quantity: i.plannedQuantity,
            unit: i.unit,
          }),
        ),
        version: null,
      })
      .expect(200);
    expect(await stock()).toBeLessThan(stockBefore);
    const skipped = await a
      .put(`/meal-records/${date}/lunch`)
      .send({ status: 'skipped', version: eaten.body.version })
      .expect(200);
    expect(await stock()).toBe(stockBefore);
    expect(skipped.body.status).toBe('skipped');
    expect(skipped.body.items.map((i: { productId: string }) => i.productId)).toEqual(
      before.body.items.map((i: { productId: string }) => i.productId),
    );
    expect(skipped.body.items.every((i: { id: string | null }) => i.id === null)).toBe(true);
    expect(skipped.body.nutrition.kcal).toBe(0);

    await a
      .put(`/meal-records/${date}/lunch`)
      .send({ status: 'eaten', kind: 'home', items: [], version: skipped.body.version })
      .expect(422);
    // 외부 식사는 품목 없이 메뉴명만으로 가능
    const outside = await a
      .put(`/meal-records/${date}/lunch`)
      .send({
        status: 'eaten',
        kind: 'outside',
        outsideMenu: '김밥',
        items: [],
        version: skipped.body.version,
      })
      .expect(200);
    await a
      .put(`/meal-records/${date}/lunch`)
      .send({ status: 'unrecorded', version: outside.body.version })
      .expect(200);
  });

  it('rejects archiving referenced templates and products (요구사항 §7-7)', async () => {
    await a.post(`/meal-templates/${template}/archive`).expect(422);
    await a.post(`/products/${chicken}/archive`).expect(422);
    await a.post('/meal-templates').send({ name: '빈 템플릿', items: [] }).expect(422);
    await a.put(`/meal-templates/${template}`).send({ name: '점심', items: [] }).expect(422);
    const t = await a
      .post('/meal-templates')
      .send({ name: '임시', items: [{ productId: chicken, quantity: 100, unit: 'g' }] })
      .expect(201);
    const archived = await a.post(`/meal-templates/${t.body.id}/archive`).expect(200);
    expect(archived.body.archivedAt).toEqual(expect.any(String));
    await a
      .put(`/plans/weekly/1/evening_snack`)
      .send({ planType: 'template', templateId: t.body.id })
      .expect(422); // 보관된 템플릿은 배정 불가
    await a.put(`/plans/weekly/1/evening_snack`).send({ planType: 'template' }).expect(422);
  });

  // ---------- 시나리오 7: 사용자 격리 ----------

  it('hides every resource of user A from user B with 404 (scenario 7, D-06)', async () => {
    await b.get(`/products/${chicken}`).expect(404);
    await b.patch(`/products/${chicken}`).send({ name: 'x' }).expect(404);
    await b.post(`/products/${chicken}/nutrition/backfill`).expect(404);
    await b.get(`/meal-templates/${template}`).expect(404);
    await b
      .post('/meal-templates')
      .send({ name: 'steal', items: [{ productId: chicken, quantity: 1, unit: 'ea' }] })
      .expect(404);
    await b
      .put(`/plans/weekly/1/lunch`)
      .send({ planType: 'template', templateId: template })
      .expect(404);
    await b
      .post('/purchases')
      .send({ productId: chicken, quantity: 1, purchasedOn: TODAY })
      .expect(404);
    await b.post('/stock-receipts').send({ productId: chicken, quantity: 1 }).expect(404);
    await b
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 1, unit: 'ea' }],
        version: null,
      })
      .expect(404);
    const bLunch = await b.get(`/meal-records/${TODAY}/lunch`).expect(200);
    expect(bLunch.body).toMatchObject({ status: 'unrecorded', planType: 'none' });
    expect((await b.get('/products')).body).toEqual([]);
    expect((await b.get('/goals')).body).toEqual([]);
    expect((await b.get(`/days/${TODAY}`)).body.nutrition.recorded.kcal).toBe(0);
    await b.get('/products/not-a-uuid').expect(404);
    // A 의 재고는 B 의 시도로 바뀌지 않았다
    expect((await a.get(`/products/${chicken}`)).body.currentStock).toBe(27);
  });
});
