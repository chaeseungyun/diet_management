/**
 * 단계 0 인수 테스트 (requirements §4 시나리오 7 + NFR-04).
 * 실제 PostgreSQL 위에서 돌며 카카오 HTTP 만 fetch 수준에서 대체한다.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseCookies } from '../src/common/cookies';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';

const WEB = 'http://localhost:3000';
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
  JWT_TTL_DAYS: '1',
  KAKAO_CLIENT_ID: 'kakao-client-id',
  KAKAO_REDIRECT_URI: `${WEB}/api/v1/auth/kakao/callback`,
  WEB_ORIGIN: WEB,
});

type KakaoStub = { ok: boolean; id?: string | number; nickname?: string | null };

function stubKakao(stub: KakaoStub): jest.Mock {
  return jest.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/oauth/token')) {
      return stub.ok
        ? Response.json({ access_token: 'kakao-access', token_type: 'bearer' })
        : new Response('bad', { status: 400 });
    }
    if (url.includes('/v2/user/me')) {
      return Response.json({ id: stub.id, properties: { nickname: stub.nickname ?? undefined } });
    }
    return new Response('unexpected', { status: 500 });
  });
}

function setCookies(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const line of list) {
    Object.assign(out, parseCookies(line.split(';')[0] ?? ''));
  }
  return out;
}

describe('phase 0: auth, isolation, account', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const realFetch = global.fetch;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
    prisma = app.get(PrismaService);
    // 다른 e2e 파일이 남긴 자식 행(기록·원장)까지 지운다. 파일은 직렬로 돈다(jest.config maxWorkers)
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE users, idempotency_keys RESTART IDENTITY CASCADE',
    );
    server = app.getHttpServer();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await app.close();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  /** 로그인 흐름 전체를 돌려 세션 쿠키를 돌려준다. */
  async function login(kakaoId: string, nickname: string | null = '테스터'): Promise<string> {
    global.fetch = stubKakao({ ok: true, id: kakaoId, nickname }) as unknown as typeof fetch;
    const start = await request(server).get('/api/v1/auth/kakao').expect(302);
    expect(start.headers.location).toMatch(/^https:\/\/kauth\.kakao\.com\/oauth\/authorize\?/);
    const state = setCookies(start)['oauth_state'];
    expect(state).toBeTruthy();
    const stateParam = new URL(start.headers.location as string).searchParams.get('state');
    expect(stateParam).toBe(state);

    const cb = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', `oauth_state=${state}`)
      .expect(302);
    expect(cb.headers.location).toBe(`${WEB}/`);
    const session = setCookies(cb)['session'];
    expect(session).toBeTruthy();
    return `session=${session}`;
  }

  it('health is public and reports db', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('unknown routes are 404', async () => {
    await request(server).get('/api/v1/nope').expect(404);
  });

  it('hides the dev login unless DEV_LOGIN_ENABLED (DEC-067)', async () => {
    await request(server).get('/api/v1/auth/dev').expect(404);
  });

  it('rejects requests without a valid session', async () => {
    await request(server).get('/api/v1/me').expect(401);
    await request(server).get('/api/v1/me').set('Cookie', 'session=garbage').expect(401);
  });

  it('logs in via kakao, creates the user once, and returns the profile', async () => {
    const cookie = await login('1001', '승윤');
    const me = await request(server).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ nickname: '승윤', timezone: 'Asia/Seoul', onboardedAt: null });

    const again = await login('1001', '승윤2');
    const me2 = await request(server).get('/api/v1/me').set('Cookie', again).expect(200);
    expect(me2.body.id).toBe(me.body.id);
    expect(me2.body.nickname).toBe('승윤'); // 재로그인은 닉네임을 덮어쓰지 않는다
    expect(await prisma.user.count({ where: { kakaoId: '1001' } })).toBe(1);
  });

  it('falls back to a default nickname when kakao gives none', async () => {
    const cookie = await login('1002', null);
    const me = await request(server).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(me.body.nickname).toBe('사용자');
  });

  it('redirects to /login?error=1 on state mismatch, provider error, or exchange failure', async () => {
    global.fetch = stubKakao({ ok: true, id: '1003' }) as unknown as typeof fetch;
    const mismatch = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ code: 'c', state: 'attacker-state' })
      .set('Cookie', 'oauth_state=real-state')
      .expect(302);
    expect(mismatch.headers.location).toBe(`${WEB}/login?error=1`);
    expect(setCookies(mismatch)['session']).toBeUndefined();

    const denied = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ error: 'access_denied', state: 's' })
      .expect(302);
    expect(denied.headers.location).toBe(`${WEB}/login?error=1`);

    global.fetch = stubKakao({ ok: false }) as unknown as typeof fetch;
    const exchangeFail = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ code: 'c', state: 's' })
      .set('Cookie', 'oauth_state=s')
      .expect(302);
    expect(exchangeFail.headers.location).toBe(`${WEB}/login?error=1`);
    expect(await prisma.user.count({ where: { kakaoId: '1003' } })).toBe(0);
  });

  it('isolates users: each session only sees itself (scenario 7)', async () => {
    const a = await login('2001', 'A');
    const b = await login('2002', 'B');
    const meA = await request(server).get('/api/v1/me').set('Cookie', a).expect(200);
    const meB = await request(server).get('/api/v1/me').set('Cookie', b).expect(200);
    expect(meA.body.id).not.toBe(meB.body.id);
    expect(meA.body.nickname).toBe('A');
    expect(meB.body.nickname).toBe('B');
  });

  it('blocks cross-site state changes (CSRF) but allows same-origin ones', async () => {
    const cookie = await login('3001');
    await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .send({ nickname: 'x' })
      .expect(403);
    await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({ nickname: 'x' })
      .expect(403);
    const ok = await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .send({ nickname: '새이름', timezone: 'Europe/Paris', onboarded: true })
      .expect(200);
    expect(ok.body).toMatchObject({ nickname: '새이름', timezone: 'Europe/Paris' });
    expect(ok.body.onboardedAt).toEqual(expect.any(String));
  });

  it('validates profile updates with 422', async () => {
    const cookie = await login('3002');
    await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .send({ timezone: 'Mars/Olympus' })
      .expect(422);
    await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .send({ nickname: '' })
      .expect(422);
    await request(server)
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .send({ kakaoId: 'hijack' })
      .expect(422);
  });

  it('logout clears the cookie', async () => {
    const res = await request(server).post('/api/v1/auth/logout').set('Origin', WEB).expect(204);
    const raw = res.headers['set-cookie'];
    const line = (Array.isArray(raw) ? raw : [raw]).find((l) => String(l).startsWith('session='));
    expect(String(line)).toMatch(/Max-Age=0/);
  });

  it('soft-deletes the account, then rejects the session and new logins', async () => {
    const cookie = await login('4001');
    await request(server).delete('/api/v1/me').set('Cookie', cookie).set('Origin', WEB).expect(204);
    await request(server).get('/api/v1/me').set('Cookie', cookie).expect(401);

    global.fetch = stubKakao({ ok: true, id: '4001' }) as unknown as typeof fetch;
    const start = await request(server).get('/api/v1/auth/kakao').expect(302);
    const state = setCookies(start)['oauth_state'];
    const cb = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ code: 'c', state })
      .set('Cookie', `oauth_state=${state}`)
      .expect(302);
    expect(cb.headers.location).toBe(`${WEB}/login?error=1`);
    const row = await prisma.user.findUnique({ where: { kakaoId: '4001' } });
    expect(row?.deletedAt).toBeTruthy();
  });
});
