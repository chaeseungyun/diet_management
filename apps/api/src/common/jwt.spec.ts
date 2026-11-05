import { signHS256, verifyHS256 } from './jwt';

const secret = 'unit-test-secret-unit-test-secret-00';

describe('HS256 jwt', () => {
  const now = 1_800_000_000;

  it('verifies what it signed', () => {
    const token = signHS256({ sub: 'u1', iat: now, exp: now + 60 }, secret);
    expect(token.split('.')).toHaveLength(3);
    expect(verifyHS256(token, secret, now)).toEqual({ sub: 'u1', iat: now, exp: now + 60 });
  });

  it('rejects expiry, wrong secret, tampering and malformed input', () => {
    const token = signHS256({ sub: 'u1', iat: now, exp: now + 60 }, secret);
    expect(verifyHS256(token, secret, now + 60)).toBeNull();
    expect(verifyHS256(token, 'other-secret-other-secret-other-00', now)).toBeNull();
    const [h, b, s] = token.split('.') as [string, string, string];
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'u2', iat: now, exp: now + 60 })).toString(
      'base64url',
    );
    expect(verifyHS256(`${h}.${forgedBody}.${s}`, secret, now)).toBeNull();
    expect(verifyHS256(`${h}.${b}.${s.slice(0, -1)}`, secret, now)).toBeNull();
    expect(verifyHS256('a.b', secret, now)).toBeNull();
    expect(verifyHS256('', secret, now)).toBeNull();
  });

  it('ignores tokens with a different header (alg none / RS256)', () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify({ sub: 'u1', iat: now, exp: now + 60 })).toString(
      'base64url',
    );
    expect(verifyHS256(`${noneHeader}.${body}.`, secret, now)).toBeNull();
  });
});
