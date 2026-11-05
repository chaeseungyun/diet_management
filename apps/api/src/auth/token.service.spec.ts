import { TokenService } from './token.service';
import type { Env } from '../config/env';

const env = { JWT_SECRET: 's'.repeat(32), JWT_TTL_DAYS: 1 } as Env;

describe('TokenService', () => {
  const svc = new TokenService(env);

  it('round-trips the user id and exposes the ttl', () => {
    expect(svc.ttl).toBe(86_400);
    expect(svc.verify(svc.sign('user-1'))).toBe('user-1');
  });

  it('rejects tampering, other secrets and garbage', () => {
    const token = svc.sign('user-1');
    expect(svc.verify(token.slice(0, -2) + 'xx')).toBeNull();
    const other = new TokenService({ ...env, JWT_SECRET: 't'.repeat(32) });
    expect(other.verify(token)).toBeNull();
    expect(svc.verify('not-a-jwt')).toBeNull();
  });
});
