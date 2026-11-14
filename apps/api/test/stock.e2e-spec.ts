/**
 * 남은 양 맞추기 — 실측 잔량 보정 (FR-03, S-42, DEC-078).
 * 사용자 보고 사례: 1000g 팩 2개 묶음을 사서 1팩을 다 먹고 다른 팩에 600g 이 남았다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');

describe('phase 2: stock adjustments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let broccoli: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    a = api(server, await login(server, 'stock-a', 'A'));
    b = api(server, await login(server, 'stock-b', 'B'));

    const p = await a
      .post('/products')
      .send({ name: '냉동 브로콜리', stockUnit: 'ea', unitLabel: '팩', unitsPerPackage: 2 })
      .expect(201);
    broccoli = p.body.id;
    expect(p.body.currentStock).toBe(0);
    const fresh = await a.get(`/products/${broccoli}`).expect(200);
    expect(fresh.body.stockUnitLocked).toBe(false);

    // 받은 적 없는 식품을 0 으로 맞춰도(차이 0) 단위는 잠기지 않는다 (DEC-081)
    const zero = await a
      .post(`/stock/${broccoli}/adjustments`)
      .send({ measuredQuantity: 0 })
      .expect(201);
    expect(zero.body).toMatchObject({ delta: 0, currentStock: 0 });
    const still = await a.get(`/products/${broccoli}`).expect(200);
    expect(still.body.stockUnitLocked).toBe(false);
    await a.patch(`/products/${broccoli}`).send({ stockUnit: 'g' }).expect(200);
    await a.patch(`/products/${broccoli}`).send({ stockUnit: 'ea', unitLabel: '팩' }).expect(200);

    await a
      .post('/purchases')
      .send({ productId: broccoli, quantity: 1, purchasedOn: TODAY, received: true })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const movements = () => prisma.stockMovement.count({ where: { productId: broccoli } });

  it('locks stockUnit after a receipt and accepts g only once a pack weight exists (D-02, D-13)', async () => {
    const detail = await a.get(`/products/${broccoli}`).expect(200);
    expect(detail.body).toMatchObject({ currentStock: 2, stockUnitLocked: true });
    await a.patch(`/products/${broccoli}`).send({ stockUnit: 'g' }).expect(422);

    await a
      .post(`/stock/${broccoli}/adjustments`)
      .send({ measuredQuantity: 600, unit: 'g' })
      .expect(422);
    await a.patch(`/products/${broccoli}`).send({ packWeightG: 1000 }).expect(200);
  });

  it('sets the measured amount by appending the difference as an adjust movement', async () => {
    const before = await movements();
    const res = await a
      .post(`/stock/${broccoli}/adjustments`)
      .set('Idempotency-Key', 'adj-1')
      .send({ measuredQuantity: 600, unit: 'g', note: '한 팩 남짓' })
      .expect(201);
    expect(res.body).toMatchObject({ productId: broccoli, delta: -1.4, currentStock: 0.6 });
    expect(res.body.movementId).toEqual(expect.any(String));
    expect(await movements()).toBe(before + 1);

    const m = await prisma.stockMovement.findUniqueOrThrow({ where: { id: res.body.movementId } });
    expect(m).toMatchObject({ reason: 'adjust', note: '한 팩 남짓' });
    expect(m.delta.toNumber()).toBe(-1.4);

    const p = await a.get(`/products/${broccoli}`).expect(200);
    expect(p.body.currentStock).toBe(0.6);

    // 같은 키 재전송은 저장된 응답, 다른 본문은 422
    const replay = await a
      .post(`/stock/${broccoli}/adjustments`)
      .set('Idempotency-Key', 'adj-1')
      .send({ measuredQuantity: 600, unit: 'g', note: '한 팩 남짓' })
      .expect(201);
    expect(replay.body).toEqual(res.body);
    await a
      .post(`/stock/${broccoli}/adjustments`)
      .set('Idempotency-Key', 'adj-1')
      .send({ measuredQuantity: 1, note: '한 팩 남짓' })
      .expect(422);
    expect(await movements()).toBe(before + 1);
  });

  it('keeps a zero adjust movement when the measured amount already matches (DEC-080 4)', async () => {
    const before = await movements();
    const res = await a
      .post(`/stock/${broccoli}/adjustments`)
      .send({ measuredQuantity: 0.6 })
      .expect(201);
    expect(res.body).toMatchObject({ delta: 0, currentStock: 0.6 });
    expect(res.body.movementId).toEqual(expect.any(String));
    expect(await movements()).toBe(before + 1);
    expect((await a.get(`/products/${broccoli}`)).body.currentStock).toBe(0.6);
  });

  it('brings a negative balance back to the measured amount', async () => {
    await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send({
        status: 'eaten',
        items: [{ productId: broccoli, quantity: 1, unit: 'ea' }],
        version: null,
      })
      .expect(200);
    expect((await a.get(`/products/${broccoli}`)).body.currentStock).toBe(-0.4);

    const res = await a
      .post(`/stock/${broccoli}/adjustments`)
      .send({ measuredQuantity: 0 })
      .expect(201);
    expect(res.body).toMatchObject({ delta: 0.4, currentStock: 0 });
  });

  it('rejects negative amounts, untracked products and other users (D-06, D-09)', async () => {
    await a.post(`/stock/${broccoli}/adjustments`).send({ measuredQuantity: -1 }).expect(422);

    const sauce = await a
      .post('/products')
      .send({ name: '소스', stockUnit: 'g', isStockTracked: false })
      .expect(201);
    await a.post(`/stock/${sauce.body.id}/adjustments`).send({ measuredQuantity: 10 }).expect(422);

    const before = await movements();
    await b.post(`/stock/${broccoli}/adjustments`).send({ measuredQuantity: 5 }).expect(404);
    await b
      .post('/stock/00000000-0000-0000-0000-000000000000/adjustments')
      .send({ measuredQuantity: 5 })
      .expect(404);
    expect(await movements()).toBe(before);
  });
});
