import { parseCookies, serializeCookie } from './cookies';

describe('cookies', () => {
  it('parses a Cookie header, keeping the first occurrence', () => {
    expect(parseCookies('a=1; b=hello%20world; a=2; bad; c="q"')).toEqual({
      a: '1',
      b: 'hello world',
      c: 'q',
    });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('serializes with the attributes we rely on', () => {
    const s = serializeCookie('session', 'tok en', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60,
    });
    expect(s).toBe('session=tok%20en; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(serializeCookie('x', '', { maxAge: 0 })).toBe('x=; Max-Age=0; Path=/');
    expect(() => serializeCookie('bad name', 'v')).toThrow(TypeError);
  });
});
