import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 최소 HS256 JWT (D-07). 외부 라이브러리 없이 node:crypto 만 쓴다.
 * 알고리즘은 HS256 하나로 고정하고 헤더의 alg 를 신뢰하지 않는다(alg confusion 방지).
 */
export interface JwtClaims {
  sub: string;
  iat: number;
  exp: number;
}

const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signHS256(claims: JwtClaims, secret: string | Uint8Array): string {
  const body = b64url(JSON.stringify(claims));
  const data = `${HEADER}.${body}`;
  return `${data}.${hmac(data, secret)}`;
}

/** 서명·구조·만료가 모두 유효하면 claims, 아니면 null. 예외를 던지지 않는다. */
export function verifyHS256(
  token: string,
  secret: string | Uint8Array,
  now: number = Math.floor(Date.now() / 1000),
): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  if (header !== HEADER) return null;

  const expected = hmac(`${header}.${body}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.exp <= now) return null;
  return claims;
}

function isClaims(v: unknown): v is JwtClaims {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.sub === 'string' &&
    o.sub.length > 0 &&
    typeof o.iat === 'number' &&
    typeof o.exp === 'number' &&
    Number.isFinite(o.exp)
  );
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function hmac(data: string, secret: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}
