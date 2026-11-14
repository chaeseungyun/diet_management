/**
 * 남은 양 현황·소진 예측·원장 (FR-03, FR-08, DEC-080·081).
 * 닭가슴살 5팩을 매일 점심 1팩씩 먹는 식단표에서 소진일이 어떻게 움직이는지 본다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { addDays } from '../src/domain/dates';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');

interface Item {
  productId: string;
  name: string;
  level: string;
  currentStock: number | null;
  depletionDate: string | null;
  daysLeft: number | null;
  beyondHorizon: boolean;
  lowConfidence: boolean;
  orderedQuantity: number;
}

describe('phase 2: stock overview and depletion forecast', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let chicken: string;
  let rice: string;
  let oat: string;
  let sauce: string;

  const overview = async (): Promise<Item[]> => (await a.get('/stock').expect(200)).body.items;
  const find = async (id: string): Promise<Item> => {
    const item = (await overview()).find((i) => i.productId === id);
    if (!item) throw new Error('product missing from /stock');
    return item;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'forecast-a', 'A'));
    b = api(server, await login(server, 'forecast-b', 'B'));

    const create = async (body: object): Promise<string> =>
      (await a.post('/products').send(body).expect(201)).body.id;
    chicken = await create({
      name: '닭가슴살',
      stockUnit: 'ea',
      unitLabel: '팩',
      packWeightG: 100,
      purchaseUrl: 'https://example.com/chicken',
    });
    rice = await create({ name: '즉석밥', stockUnit: 'ea', unitLabel: '개' });
    oat = await create({ name: '오트밀', stockUnit: 'g' });
    sauce = await create({ name: '소스', stockUnit: 'g', isStockTracked: false });

    await a
      .post('/purchases')
      .send({ productId: chicken, quantity: 5, purchasedOn: TODAY, received: true })
      .expect(201);
    await a
      .post('/purchases')
      .send({ productId: oat, quantity: 1000, purchasedOn: TODAY, received: true })
      .expect(201);
    await a
      .post('/purchases')
      .send({ productId: rice, quantity: 6, purchasedOn: TODAY })
      .expect(201);

    const template = await a
      .post('/meal-templates')
      .send({
        name: '점심',
        items: [
          { productId: chicken, quantity: 100, unit: 'g' },
          { productId: sauce, quantity: 10, unit: 'g' },
        ],
      })
      .expect(201);
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      await a
        .put(`/plans/weekly/${weekday}/lunch`)
        .send({ planType: 'template', templateId: template.body.id })
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists one badge per product, things to act on first (DEC-080 7)', async () => {
    const res = await a.get('/stock').expect(200);
    expect(res.body).toMatchObject({ today: TODAY, daysBefore: 3, horizonDays: 60 });
    const items: Item[] = res.body.items;
    expect(items.map((i) => [i.name, i.level])).toEqual([
      ['즉석밥', 'depleted'],
      ['닭가슴살', 'ok'],
      ['오트밀', 'unpredictable'],
      ['소스', 'untracked'],
    ]);
    // 5팩, 오늘부터 하루 1팩(100g) → 오늘+5일의 점심을 못 채운다
    expect(items[1]).toMatchObject({
      currentStock: 5,
      depletionDate: addDays(TODAY, 5),
      daysLeft: 5,
      beyondHorizon: false,
      lowConfidence: false,
    });
    // 배송 중은 재고·예측에 넣지 않고 따로 보인다
    expect(items[0]).toMatchObject({ currentStock: 0, orderedQuantity: 6, depletionDate: null });
    expect(items[3]).toMatchObject({ currentStock: null });
  });

  it('does not count a meal already eaten today twice', async () => {
    await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: chicken, quantity: 1, unit: 'ea' }],
        version: null,
      })
      .expect(200);
    // 4팩 남았고 오늘 점심은 이미 빠졌다 → 소진일은 그대로
    expect(await find(chicken)).toMatchObject({
      currentStock: 4,
      depletionDate: addDays(TODAY, 5),
    });
  });

  it('reflects thrown-away amounts through measuring what is left (DEC-081)', async () => {
    // 두 팩을 버렸다 → 남은 양을 2팩으로 맞춘다. 버린 양만 받는 입력은 없다
    const res = await a
      .post(`/stock/${chicken}/adjustments`)
      .send({ measuredQuantity: 200, unit: 'g', note: '유통기한 지남' })
      .expect(201);
    expect(res.body).toMatchObject({ delta: -2, currentStock: 2 });
    const m = await prisma.stockMovement.findUniqueOrThrow({ where: { id: res.body.movementId } });
    expect(m).toMatchObject({ reason: 'adjust', note: '유통기한 지남' });

    // 2팩 → 내일·모레를 채우고 오늘+3일에 떨어진다 → 소진 임박
    expect(await find(chicken)).toMatchObject({
      currentStock: 2,
      level: 'imminent',
      depletionDate: addDays(TODAY, 3),
      daysLeft: 3,
    });

    await a.post(`/stock/${chicken}/adjustments`).send({}).expect(422);
    await a.post(`/stock/${chicken}/adjustments`).send({ wasteQuantity: 1 }).expect(422);
  });

  it("shows imminent products on today's screen only (DEC-080 13)", async () => {
    const today = await a.get(`/days/${TODAY}`).expect(200);
    expect(today.body.depleting.map((i: Item) => i.name)).toEqual(['닭가슴살']);
    const tomorrow = await a.get(`/days/${addDays(TODAY, 1)}`).expect(200);
    expect(tomorrow.body.depleting).toEqual([]);
  });

  it('reports products whose depletion date moved when a date override is saved (S-24)', async () => {
    const batch = await a
      .post('/plans/overrides/batch')
      .send({
        from: addDays(TODAY, 1),
        to: addDays(TODAY, 2),
        slots: ['lunch'],
        planType: 'none',
        note: '출장',
      })
      .expect(201);
    expect(batch.body.depletionChanges).toEqual([
      { productId: chicken, name: '닭가슴살', before: addDays(TODAY, 3), after: addDays(TODAY, 5) },
    ]);

    // 한 끼만 되돌리면 하루 당겨진다
    const one = await a
      .put(`/plans/overrides/${addDays(TODAY, 4)}/lunch`)
      .send({ planType: 'none' })
      .expect(200);
    expect(one.body.depletionChanges).toEqual([
      { productId: chicken, name: '닭가슴살', before: addDays(TODAY, 5), after: addDays(TODAY, 6) },
    ]);
    // 바뀌는 것이 없으면 빈 배열
    const same = await a
      .put(`/plans/overrides/${addDays(TODAY, 4)}/lunch`)
      .send({ planType: 'none', note: '메모만' })
      .expect(200);
    expect(same.body.depletionChanges).toEqual([]);
  });

  it('returns the forecast of one product for the product screen (S-32)', async () => {
    const res = await a.get(`/stock/${chicken}`).expect(200);
    // 오늘(먹음)·내일·모레·+4(예외)는 빠지고 +3·+5 를 채운 뒤 +6 에 모자란다
    expect(res.body).toMatchObject({
      productId: chicken,
      today: TODAY,
      horizonDays: 60,
      archived: false,
      depletionDate: addDays(TODAY, 6),
      daysLeft: 6,
      purchaseUrl: 'https://example.com/chicken',
    });
    expect(res.body.planned).toBeUndefined();
  });

  it('pages the ledger newest first and links meals', async () => {
    const res = await a.get(`/stock/${chicken}/movements`).expect(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((m: { reason: string }) => m.reason)).toEqual([
      'adjust',
      'consume',
      'receipt',
    ]);
    expect(res.body.items[1]).toMatchObject({ delta: -1, meal: { date: TODAY, slot: 'lunch' } });
    expect(res.body.items[0].meal).toBeNull();

    const last = res.body.items[2].id;
    const next = await a.get(`/stock/${chicken}/movements?cursor=${last}`).expect(200);
    expect(next.body.items).toEqual([]);
    await a.get(`/stock/${chicken}/movements?cursor=nope`).expect(422);
  });

  it('flags low confidence after an unrecorded planned meal until the amount is measured (DEC-080 4)', async () => {
    // 원장을 닷새 전으로 옮기면 그 뒤 나흘의 점심이 미기록 과거가 된다
    await prisma.stockMovement.updateMany({
      where: { productId: chicken },
      data: { createdAt: new Date(Date.now() - 5 * 86_400_000) },
    });
    // 식단표 칸이 바뀐 날(오늘)까지는 당시 계획을 알 수 없어 세지 않는다 (DEC-081)
    expect((await find(chicken)).lowConfidence).toBe(false);
    await prisma.weeklySchedule.updateMany({
      data: { updatedAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    expect((await find(chicken)).lowConfidence).toBe(true);
    expect((await find(oat)).lowConfidence).toBe(false);

    // 세어 보니 기록과 같았다 → 차이는 0 이지만 확인한 사실을 원장에 남겨 표시를 끈다
    const res = await a
      .post(`/stock/${chicken}/adjustments`)
      .send({ measuredQuantity: 2 })
      .expect(201);
    expect(res.body).toMatchObject({ delta: 0, currentStock: 2 });
    expect(res.body.movementId).toEqual(expect.any(String));
    expect((await find(chicken)).lowConfidence).toBe(false);
  });

  it('stops forecasting on a negative balance (D-21)', async () => {
    // 가진 것보다 많이 먹었다고 적으면 합계가 음수가 된다
    const me = await prisma.user.findFirstOrThrow({
      where: { products: { some: { id: chicken } } },
    });
    await prisma.stockMovement.create({
      data: { userId: me.id, productId: chicken, delta: -5, reason: 'consume' },
    });
    expect(await find(chicken)).toMatchObject({
      level: 'check_needed',
      currentStock: -3,
      depletionDate: null,
    });
    const today = await a.get(`/days/${TODAY}`).expect(200);
    expect(today.body.depleting).toEqual([]);
  });

  it('hides archived products from the list but keeps their detail (DEC-080 8)', async () => {
    await a.post(`/products/${oat}/archive`).expect(200);
    expect((await overview()).map((i) => i.name)).not.toContain('오트밀');
    const detail = await a.get(`/stock/${oat}`).expect(200);
    expect(detail.body).toMatchObject({ archived: true, currentStock: 1000 });
  });

  it("returns 404 for another user's product and an empty list for a new user (D-06)", async () => {
    await b.get(`/stock/${chicken}`).expect(404);
    await b.get(`/stock/${chicken}/movements`).expect(404);
    await b.post(`/stock/${chicken}/adjustments`).send({ measuredQuantity: 1 }).expect(404);
    const res = await b.get('/stock').expect(200);
    expect(res.body.items).toEqual([]);
  });
});
