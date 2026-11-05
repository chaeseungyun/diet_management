import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { KakaoService } from './kakao.service';
import { TokenService } from './token.service';
import { Public } from './auth.guard';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  appendCookie,
  clearCookie,
  readCookie,
  sessionCookieOptions,
} from '../common/cookies';

const STATE_TTL_SECONDS = 10 * 60;
const STATE_COOKIE_PATH = '/api/v1/auth';
const DEFAULT_NICKNAME = '사용자';

/**
 * 카카오 로그인 (FR-01, NFR-04, D-07, D-14).
 * 콜백은 이 API가 받고, 성공하면 JWT 쿠키를 발급한 뒤 웹 `/`로 302, 실패하면 `/login?error=1`로 302 한다.
 * 실패 사유는 응답에 싣지 않고 서버 로그에만 남긴다.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly log = new Logger(AuthController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly kakao: KakaoService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('kakao')
  @ApiOperation({ summary: '카카오 로그인 시작. state 쿠키를 심고 카카오로 302' })
  start(@Res() res: Response): void {
    const state = randomBytes(32).toString('base64url');
    appendCookie(res, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.cookieSecure,
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    res.redirect(302, this.kakao.authorizeUrl(state));
  }

  @Public()
  @Get('kakao/callback')
  @ApiExcludeEndpoint()
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    clearCookie(res, OAUTH_STATE_COOKIE, this.env.cookieSecure, STATE_COOKIE_PATH);
    const fail = (reason: string): void => {
      this.log.warn(`kakao login failed: ${reason}`);
      res.redirect(302, `${this.env.WEB_ORIGIN}/login?error=1`);
    };

    if (error) return fail(`provider_error:${error}`);
    if (!code || !state) return fail('missing_code_or_state');
    const expected = readCookie(req, OAUTH_STATE_COOKIE);
    if (!expected || !safeEqual(expected, state)) return fail('state_mismatch');

    let kakaoId: string;
    let nickname: string | null;
    try {
      const accessToken = await this.kakao.exchangeCode(code);
      ({ kakaoId, nickname } = await this.kakao.fetchProfile(accessToken));
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'provider_unreachable');
    }

    const existing = await this.prisma.user.findUnique({ where: { kakaoId } });
    if (existing?.deletedAt) return fail('user_deleted');

    const user =
      existing ??
      (await this.prisma.user.create({
        data: { kakaoId, nickname: nickname ?? DEFAULT_NICKNAME },
      }));

    const jwt = this.tokens.sign(user.id);
    appendCookie(
      res,
      SESSION_COOKIE,
      jwt,
      sessionCookieOptions(this.env.cookieSecure, this.tokens.ttl),
    );
    res.redirect(302, `${this.env.WEB_ORIGIN}/`);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: '로그아웃 = 쿠키 삭제 (서버 상태 없음, D-07)' })
  logout(@Res() res: Response): void {
    clearCookie(res, SESSION_COOKIE, this.env.cookieSecure);
    res.status(204).end();
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
