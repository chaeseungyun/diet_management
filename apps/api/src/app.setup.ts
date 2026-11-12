import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@diet/shared';
import type { Env } from './config/env';
import { ApiExceptionFilter, ErrorDto, validationException } from './common/errors';

/** main.ts 와 e2e 테스트가 같은 설정을 쓰도록 분리 (api.md §0 공통 규칙). */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // 검증 실패는 422 VALIDATION_FAILED + fields (api.md §0, DEC-079)
      errorHttpStatusCode: 422,
      exceptionFactory: validationException,
    }),
  );
  // 오류 본문 형식 { statusCode, code, message, fields? } (DEC-079)
  app.useGlobalFilters(new ApiExceptionFilter());
  const express = app as NestExpressApplication;
  if (typeof express.set === 'function') {
    // Caddy 뒤에서 Secure 쿠키·프로토콜 판단 (D-14)
    express.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
    express.disable('x-powered-by');
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('diet-app API')
    .setDescription('식단·재고·체중 관리 API. 인증은 HttpOnly 쿠키의 JWT (D-07).')
    .setVersion('0.0.0')
    .addCookieAuth('session')
    .build();
  return SwaggerModule.createDocument(app, config, { extraModels: [ErrorDto] });
}
