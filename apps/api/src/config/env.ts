import { z } from 'zod';

/**
 * 환경 변수 검증. 잘못된 값이면 부팅 자체를 실패시켜 운영 중 오동작을 막는다(NFR-05).
 * 비밀 값은 로그에 남기지 않는다(NFR-04).
 */
const boolFromString = z
  .enum(['true', 'false', ''])
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : v === 'true'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_DAYS: z.coerce.number().int().positive().max(90).default(7),
  KAKAO_CLIENT_ID: z.string().min(1),
  KAKAO_CLIENT_SECRET: z.string().optional().default(''),
  KAKAO_REDIRECT_URI: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  COOKIE_SECURE: boolFromString,
  /** 개발·테스트용 로그인(GET /auth/dev). production 에서는 켤 수 없다 */
  DEV_LOGIN_ENABLED: boolFromString,
});

export type Env = z.infer<typeof schema> & { cookieSecure: boolean; devLoginEnabled: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED) {
    throw new Error('Invalid environment: DEV_LOGIN_ENABLED must not be set in production');
  }
  // WEB_ORIGIN은 오리진만 남긴다(경로·슬래시 제거) → Origin 헤더와 그대로 비교
  const webOrigin = new URL(env.WEB_ORIGIN).origin;
  return {
    ...env,
    WEB_ORIGIN: webOrigin,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    devLoginEnabled: env.DEV_LOGIN_ENABLED ?? false,
  };
}

/** DI 토큰 */
export const ENV = Symbol('ENV');
