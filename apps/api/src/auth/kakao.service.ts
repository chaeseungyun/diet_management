import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

export interface KakaoProfile {
  kakaoId: string;
  nickname: string | null;
}

const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';
/** 외부 OAuth 호출 타임아웃 (NFR-03) */
const TIMEOUT_MS = 5_000;

/**
 * 카카오 OAuth 2.0 (DEC-015). 라이브러리 없이 두 요청(토큰 교환, 프로필 조회)만 쓴다.
 * 최소 프로필(id, nickname)만 읽는다(NFR-04).
 */
@Injectable()
export class KakaoService {
  private readonly log = new Logger(KakaoService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  authorizeUrl(state: string): string {
    const u = new URL('/oauth/authorize', KAUTH);
    u.searchParams.set('client_id', this.env.KAKAO_CLIENT_ID);
    u.searchParams.set('redirect_uri', this.env.KAKAO_REDIRECT_URI);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.env.KAKAO_CLIENT_ID,
      redirect_uri: this.env.KAKAO_REDIRECT_URI,
      code,
    });
    if (this.env.KAKAO_CLIENT_SECRET) body.set('client_secret', this.env.KAKAO_CLIENT_SECRET);

    const res = await fetch(`${KAUTH}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.log.warn(`kakao token exchange failed: ${res.status}`);
      throw new Error('kakao_token_exchange_failed');
    }
    const json = (await res.json()) as { access_token?: unknown };
    if (typeof json.access_token !== 'string') throw new Error('kakao_token_missing');
    return json.access_token;
  }

  async fetchProfile(accessToken: string): Promise<KakaoProfile> {
    const res = await fetch(`${KAPI}/v2/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.log.warn(`kakao profile fetch failed: ${res.status}`);
      throw new Error('kakao_profile_failed');
    }
    const json = (await res.json()) as {
      id?: unknown;
      properties?: { nickname?: unknown };
      kakao_account?: { profile?: { nickname?: unknown } };
    };
    if (json.id === undefined || json.id === null) throw new Error('kakao_profile_id_missing');
    const nick = json.properties?.nickname ?? json.kakao_account?.profile?.nickname;
    return { kakaoId: String(json.id), nickname: typeof nick === 'string' ? nick : null };
  }
}
