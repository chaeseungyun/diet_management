/** 개발·테스트용 로그인 (DEC-067): 켜진 환경에서만 열리고, 계정은 dev:<name> 으로 격리된다 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { WEB, setCookies, testEnv } from './helpers';

describe('dev login', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: testEnv.JWT_SECRET,
      KAKAO_CLIENT_ID: testEnv.KAKAO_CLIENT_ID,
      KAKAO_REDIRECT_URI: testEnv.KAKAO_REDIRECT_URI,
      WEB_ORIGIN: WEB,
      DEV_LOGIN_ENABLED: 'true',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await prisma.user.deleteMany({ where: { kakaoId: { startsWith: 'dev:' } } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a session for dev:tester once, and separate accounts via ?as=', async () => {
    const first = await request(server).get('/api/v1/auth/dev').expect(302);
    expect(first.headers['location']).toBe(`${WEB}/`);
    const cookie = `session=${setCookies(first)['session']}`;
    const me = await request(server).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(me.body.nickname).toBe('테스터');

    await request(server).get('/api/v1/auth/dev').expect(302);
    expect(await prisma.user.count({ where: { kakaoId: 'dev:tester' } })).toBe(1);

    const other = await request(server).get('/api/v1/auth/dev?as=second').expect(302);
    const otherMe = await request(server)
      .get('/api/v1/me')
      .set('Cookie', `session=${setCookies(other)['session']}`)
      .expect(200);
    expect(otherMe.body.id).not.toBe(me.body.id);
    expect(otherMe.body.nickname).toBe('second');

    await request(server).get('/api/v1/auth/dev?as=Bad%20Name').expect(404);
  });
});
