import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { signHS256, verifyHS256 } from '../common/jwt';

/**
 * stateless JWT (D-07). HS256, 서버 비밀로 서명. 서버 세션 저장소 없음.
 * payload 는 sub(userId)·iat·exp 만 둔다. 개인정보를 토큰에 싣지 않는다.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.JWT_SECRET;
    this.ttlSeconds = env.JWT_TTL_DAYS * 24 * 60 * 60;
  }

  get ttl(): number {
    return this.ttlSeconds;
  }

  sign(userId: string): string {
    const now = Math.floor(Date.now() / 1000);
    return signHS256({ sub: userId, iat: now, exp: now + this.ttlSeconds }, this.secret);
  }

  /** 유효하면 userId, 아니면 null. */
  verify(token: string): string | null {
    return verifyHS256(token, this.secret)?.sub ?? null;
  }
}
