/** e2e 공용: 앱 부팅, 카카오 stub, 로그인 쿠키 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseCookies } from '../src/common/cookies';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';

export const WEB = 'http://localhost:3000';

export const testEnv = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
  JWT_TTL_DAYS: '1',
  KAKAO_CLIENT_ID: 'kakao-client-id',
  KAKAO_REDIRECT_URI: `${WEB}/api/v1/auth/kakao/callback`,
  WEB_ORIGIN: WEB,
});

type KakaoStub = { ok: boolean; id?: string | number; nickname?: string | null };

export function stubKakao(stub: KakaoStub): jest.Mock {
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

export function setCookies(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const line of list) Object.assign(out, parseCookies(line.split(';')[0] ?? ''));
  return out;
}

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv)],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, testEnv);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** 로그인 흐름 전체를 돌려 세션 쿠키를 돌려준다 */
export async function login(
  server: Parameters<typeof request>[0],
  kakaoId: string,
  nickname: string | null = '테스터',
): Promise<string> {
  const realFetch = global.fetch;
  global.fetch = stubKakao({ ok: true, id: kakaoId, nickname }) as unknown as typeof fetch;
  try {
    const start = await request(server).get('/api/v1/auth/kakao').expect(302);
    const state = setCookies(start)['oauth_state'];
    const cb = await request(server)
      .get('/api/v1/auth/kakao/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', `oauth_state=${state}`)
      .expect(302);
    const session = setCookies(cb)['session'];
    if (!session) throw new Error('login failed');
    return `session=${session}`;
  } finally {
    global.fetch = realFetch;
  }
}

/** 같은 오리진 쓰기 요청 (Origin 헤더로 CSRF 검사 통과) */
export function api(server: Parameters<typeof request>[0], cookie: string) {
  const base = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
    request(server)[m](`/api/v1${path}`).set('Cookie', cookie).set('Origin', WEB);
  return {
    get: (path: string) => base('get', path),
    post: (path: string) => base('post', path),
    put: (path: string) => base('put', path),
    patch: (path: string) => base('patch', path),
    delete: (path: string) => base('delete', path),
  };
}
