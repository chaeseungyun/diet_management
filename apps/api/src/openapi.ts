/**
 * OpenAPI 문서를 파일로 내보낸다 (D-05). 프런트는 이 파일에서 타입을 생성한다.
 * DB 연결 없이 동작하도록 더미 환경을 쓰고 app.init() 을 호출하지 않는다.
 *   pnpm --filter @diet/api openapi:export
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './app.setup';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
    JWT_SECRET: 'openapi-export-dummy-secret-00000000',
    KAKAO_CLIENT_ID: 'x',
    KAKAO_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/kakao/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  });
  const app = await NestFactory.create(AppModule.forRoot(env), {
    logger: ['error'],
    abortOnError: false,
  });
  configureApp(app, env);
  const doc = buildOpenApiDocument(app);
  const out = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${out}`);
  await app.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
