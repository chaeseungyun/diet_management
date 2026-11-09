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
  /** Web Push VAPID 키(base64url, DEC-072·074). 비어 있으면 푸시 기능이 꺼진다. 개인키는 비밀 */
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  /** 푸시 서비스가 연락할 주소. mailto: 또는 https: (RFC 8292) */
  VAPID_SUBJECT: z.string().optional().default(''),
  /** 알림 스케줄러(매분 판정·발송). 켜려면 VAPID 3개가 모두 있어야 한다 */
  NOTIFICATIONS_ENABLED: boolFromString,
});

export type Env = z.infer<typeof schema> & {
  cookieSecure: boolean;
  devLoginEnabled: boolean;
  /** VAPID 3개가 모두 유효하면 true */
  pushEnabled: boolean;
  notificationsEnabled: boolean;
};

/** base64url 로 인코딩된 바이트 길이 검사 (P-256 공개키 65바이트, 개인키 32바이트) */
function base64urlBytes(s: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return Buffer.from(s, 'base64url').length;
}

function checkVapid(env: z.infer<typeof schema>): boolean {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: sub } = env;
  if (!pub && !priv && !sub) return false;
  if (!pub || !priv || !sub) {
    throw new Error(
      'Invalid environment: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT must be set together',
    );
  }
  if (base64urlBytes(pub) !== 65)
    throw new Error('Invalid environment: VAPID_PUBLIC_KEY must be a base64url P-256 public key');
  if (base64urlBytes(priv) !== 32)
    throw new Error('Invalid environment: VAPID_PRIVATE_KEY must be a base64url P-256 private key');
  if (!sub.startsWith('mailto:') && !sub.startsWith('https://'))
    throw new Error('Invalid environment: VAPID_SUBJECT must start with mailto: or https://');
  return true;
}

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
  const pushEnabled = checkVapid(env);
  if (env.NOTIFICATIONS_ENABLED && !pushEnabled) {
    throw new Error('Invalid environment: NOTIFICATIONS_ENABLED requires VAPID keys');
  }
  // WEB_ORIGIN은 오리진만 남긴다(경로·슬래시 제거) → Origin 헤더와 그대로 비교
  const webOrigin = new URL(env.WEB_ORIGIN).origin;
  return {
    ...env,
    WEB_ORIGIN: webOrigin,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    devLoginEnabled: env.DEV_LOGIN_ENABLED ?? false,
    pushEnabled,
    notificationsEnabled: env.NOTIFICATIONS_ENABLED ?? false,
  };
}

/** DI 토큰 */
export const ENV = Symbol('ENV');
