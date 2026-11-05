import 'server-only';
import { cookies } from 'next/headers';
import { API_PREFIX } from '@diet/shared';
import type { components } from './api-types';

export type MeDto = components['schemas']['MeDto'];

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * 서버 컴포넌트에서 API를 호출한다. 브라우저 쿠키(JWT)를 그대로 전달한다.
 * 업무 규칙은 API에만 있다(NFR-07). 여기서는 전달·역직렬화만 한다.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  return fetch(`${API_INTERNAL_URL}${API_PREFIX}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader },
    cache: 'no-store',
  });
}

/** 로그인 사용자. 미인증이면 null. */
export async function getMe(): Promise<MeDto | null> {
  const res = await apiFetch('/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
  return (await res.json()) as MeDto;
}
