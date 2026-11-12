/**
 * 오류 본문 형식 (DEC-079, api.md §0): { statusCode, code, message, fields? }.
 * 웹은 code 로 화면 문구를 고르므로 code 가 빠지거나 바뀌면 안 된다.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ERROR_CODES, todayIn } from '@diet/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { WEB, api, createApp, login } from './helpers';

const TODAY = todayIn('Asia/Seoul');

describe('error body format', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let a: ReturnType<typeof api>;
  let cookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    cookie = await login(server, 'err-a', 'A');
    a = api(server, cookie);
  });

  afterAll(async () => {
    await app.close();
  });

  const shape = (body: unknown, statusCode: number, code: string) => {
    expect(body).toMatchObject({ statusCode, code, message: expect.any(String) });
    expect(ERROR_CODES).toContain(code);
  };

  it('defaults the code from the status (401, 403, 404)', async () => {
    const anon = await request(server).get('/api/v1/products').expect(401);
    shape(anon.body, 401, 'UNAUTHENTICATED');

    const csrf = await request(server)
      .post('/api/v1/products')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({ name: 'x', stockUnit: 'g' })
      .expect(403);
    shape(csrf.body, 403, 'CSRF_REJECTED');

    const missing = await a.get('/products/00000000-0000-0000-0000-000000000000').expect(404);
    shape(missing.body, 404, 'NOT_FOUND');
    const route = await a.get('/no-such-route').expect(404);
    shape(route.body, 404, 'NOT_FOUND');
  });

  it('reports validation failures with field paths and rules', async () => {
    const res = await a
      .post('/products')
      .send({ name: 'x', stockUnit: 'kg', unitsPerPackage: -1 })
      .expect(422);
    shape(res.body, 422, 'VALIDATION_FAILED');
    expect(res.body.fields).toEqual(
      expect.arrayContaining([
        { field: 'stockUnit', rule: 'isIn' },
        expect.objectContaining({ field: 'unitsPerPackage' }),
      ]),
    );

    const nested = await a
      .put(`/meal-records/${TODAY}/lunch`)
      .send({
        status: 'eaten',
        items: [{ productId: 'nope', quantity: -1, unit: 'g' }],
        version: null,
      })
      .expect(422);
    expect(nested.body.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'items.0.quantity' })]),
    );
  });

  it('answers malformed JSON with 400 BAD_REQUEST', async () => {
    const res = await request(server)
      .post('/api/v1/products')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);
    shape(res.body, 400, 'BAD_REQUEST');
  });

  it('carries domain codes (STOCK_UNIT_LOCKED, RECORD_CONFLICT, WEIGHT_EXISTS, EMPTY_HOME_MEAL)', async () => {
    const p = await a
      .post('/products')
      .send({
        name: '닭가슴살',
        stockUnit: 'ea',
        unitLabel: '팩',
        unitsPerPackage: 1,
        initialStock: 3,
      })
      .expect(201);
    const locked = await a.patch(`/products/${p.body.id}`).send({ stockUnit: 'g' }).expect(422);
    shape(locked.body, 422, 'STOCK_UNIT_LOCKED');
    expect(locked.body.fields).toBeUndefined();

    const body = {
      status: 'eaten',
      items: [{ productId: p.body.id, quantity: 1, unit: 'ea' }],
      version: null,
    };
    await a.put(`/meal-records/${TODAY}/lunch`).send(body).expect(200);
    const stale = await a.put(`/meal-records/${TODAY}/lunch`).send(body).expect(409);
    shape(stale.body, 409, 'RECORD_CONFLICT');

    const empty = await a
      .put(`/meal-records/${TODAY}/dinner`)
      .send({ status: 'eaten', items: [], version: null })
      .expect(422);
    shape(empty.body, 422, 'EMPTY_HOME_MEAL');

    await a.put(`/weights/${TODAY}`).send({ weightKg: 70 }).expect(200);
    const dup = await a.put(`/weights/${TODAY}`).send({ weightKg: 71 }).expect(409);
    shape(dup.body, 409, 'WEIGHT_EXISTS');
  });

  it('keeps the health body as is', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
