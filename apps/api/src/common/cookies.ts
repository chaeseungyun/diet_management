import type { Request, Response } from 'express';
import { SESSION_COOKIE } from '@diet/shared';

export const OAUTH_STATE_COOKIE = 'oauth_state';
export { SESSION_COOKIE };

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
}

/** `Cookie` 헤더를 이름→값으로 파싱한다. 값은 URL 디코딩하고 실패하면 원문을 둔다. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** `Set-Cookie` 값을 만든다. 값은 URL 인코딩한다. */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  if (!COOKIE_NAME_RE.test(name)) throw new TypeError(`invalid cookie name: ${name}`);
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`;
  s += `; Path=${opts.path ?? '/'}`;
  if (opts.httpOnly) s += '; HttpOnly';
  if (opts.secure) s += '; Secure';
  if (opts.sameSite) s += `; SameSite=${opts.sameSite[0]!.toUpperCase()}${opts.sameSite.slice(1)}`;
  return s;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

/** 인증 쿠키 공통 옵션 (D-07): HttpOnly, SameSite=Lax, Path=/ */
export function sessionCookieOptions(secure: boolean, maxAgeSeconds: number): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: maxAgeSeconds };
}

export function appendCookie(
  res: Response,
  name: string,
  value: string,
  opts: CookieOptions,
): void {
  res.append('Set-Cookie', serializeCookie(name, value, opts));
}

export function clearCookie(res: Response, name: string, secure: boolean, path = '/'): void {
  res.append(
    'Set-Cookie',
    serializeCookie(name, '', { httpOnly: true, sameSite: 'lax', secure, path, maxAge: 0 }),
  );
}
