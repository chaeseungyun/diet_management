import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  KAKAO_CLIENT_ID: 'kid',
  KAKAO_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/kakao/callback',
  WEB_ORIGIN: 'http://localhost:3000/',
};

describe('loadEnv', () => {
  it('applies defaults and normalises WEB_ORIGIN to an origin', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(4000);
    expect(env.JWT_TTL_DAYS).toBe(7);
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.cookieSecure).toBe(false);
    expect(env.devLoginEnabled).toBe(false);
  });

  it('forces secure cookies in production unless overridden', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure).toBe(
      false,
    );
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('allows the dev login outside production only (DEC-067)', () => {
    expect(loadEnv({ ...base, DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled).toBe(true);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' })).toThrow(
      /DEV_LOGIN_ENABLED/,
    );
  });
});
