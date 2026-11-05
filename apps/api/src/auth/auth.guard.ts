import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { SESSION_COOKIE, readCookie } from '../common/cookies';

export const IS_PUBLIC = 'isPublic';
/** 인증 없이 접근 가능한 핸들러 표시 (health, 로그인 시작·콜백, 로그아웃) */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { user: User };

/** 컨트롤러에서 세션 사용자를 받는다. 모든 조회·수정은 이 사용자 범위로 강제한다(NFR-04). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

/**
 * 전역 가드. 쿠키의 JWT를 검증하고 활성 사용자(deleted_at IS NULL)를 요청에 붙인다.
 * 토큰이 없거나 틀리거나 사용자가 삭제됐으면 401.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException();

    const userId = this.tokens.verify(token);
    if (!userId) throw new UnauthorizedException();

    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException();

    req.user = user;
    return true;
  }
}
