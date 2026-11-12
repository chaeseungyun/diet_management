import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from './errors';
import { ENV, type Env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF 방어 (NFR-04, D-07): 상태를 바꾸는 요청은 Origin(없으면 Referer)이 WEB_ORIGIN과 같아야 한다.
 * SameSite=Lax 쿠키와 함께 이중으로 막는다. 불일치는 403 (리소스 존재 여부와 무관한 거부라 D-06의 404 규칙 대상이 아니다).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin ?? originOf(req.headers.referer);
    if (origin !== this.env.WEB_ORIGIN) {
      throw new AppException(403, 'CSRF_REJECTED', 'Cross-site request rejected');
    }
    return true;
  }
}

function originOf(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
