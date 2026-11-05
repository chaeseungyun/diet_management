'use client';

import { API_PREFIX, IDEMPOTENCY_HEADER } from '@diet/shared';

/** API 오류. status 로 409(충돌)·422(검증)·404 를 화면이 구분한다 (G-01, G-03) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(messageOf(status, body));
  }
}

function messageOf(status: number, body: unknown): string {
  const m =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message: unknown }).message
      : null;
  const text = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
  if (status === 409)
    return text || '다른 기기에서 수정되었습니다. 새로 고침 후 다시 시도해 주세요.';
  if (status === 422) return text || '입력값을 확인해 주세요.';
  if (status === 404) return '찾을 수 없습니다.';
  if (status === 401) return '로그인이 필요합니다.';
  return text || `요청에 실패했습니다 (${status})`;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * 브라우저에서 같은 오리진 API 호출 (D-14). 쿠키는 자동, Origin 헤더로 CSRF 검사를 통과한다.
 * idempotent=true 면 호출마다 새 Idempotency-Key 를 붙인다(재시도는 같은 키를 다시 넘긴다).
 */
export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey;
  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
