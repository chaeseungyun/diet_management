'use client';

import {
  API_PREFIX,
  IDEMPOTENCY_HEADER,
  defaultErrorCode,
  isErrorCode,
  type ErrorCode,
} from '@diet/shared';
import {
  ERROR_MESSAGES,
  NETWORK_MESSAGE,
  UNKNOWN_MESSAGE,
  fieldMessage,
  type ErrorMessageOptions,
} from './error-messages';

type ErrorField = { field: string; rule: string };

/**
 * API 오류. status 로 409(충돌)·422(검증)·404 를, code 로 사유를 구분한다 (G-01, G-03, DEC-079).
 * message 는 화면 문구(해요체)이고, 서버의 개발자용 문장은 serverMessage 에만 둔다.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields: ErrorField[] | undefined;
  readonly serverMessage: string | null;

  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const code = isErrorCode(b.code) ? b.code : defaultErrorCode(status);
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.fields = Array.isArray(b.fields) ? (b.fields as ErrorField[]) : undefined;
    const m = b.message;
    this.serverMessage = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : null;
  }
}

/** fetch 자체가 실패했다(오프라인·서버 꺼짐). 요청이 서버에 닿았는지는 알 수 없다 */
export class NetworkError extends Error {
  constructor(readonly cause: unknown) {
    super(NETWORK_MESSAGE);
  }
}

/**
 * 화면에 보일 오류 문구. 화면 덮어쓰기 → 검증 필드 라벨 → 코드 표 → 네트워크 → 알 수 없음(콘솔에 남김).
 * 원문은 개발 모드에서만 콘솔에 남긴다(DEC-079: 배너에 붙이지 않음).
 */
export function describeError(e: unknown, opts: ErrorMessageOptions = {}): string {
  if (e instanceof ApiError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[api] ${e.status} ${e.code}: ${e.serverMessage ?? ''}`, e.fields ?? '');
    }
    return (
      opts.messages?.[e.code] ??
      (e.code === 'VALIDATION_FAILED' ? fieldMessage(e.fields, opts.fields) : null) ??
      e.message
    );
  }
  if (e instanceof NetworkError) return e.message;
  console.error(e);
  return UNKNOWN_MESSAGE;
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
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 프록시 오류 페이지(HTML) 등. 상태 코드만으로 판단한다
    if (res.ok) throw new ApiError(502, null);
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
