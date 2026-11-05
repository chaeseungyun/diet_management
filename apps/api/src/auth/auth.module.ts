import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { KakaoService } from './kakao.service';
import { TokenService } from './token.service';
import { OriginGuard } from '../common/origin.guard';

@Module({
  controllers: [AuthController],
  providers: [
    KakaoService,
    TokenService,
    // 가드 순서: Origin(CSRF) → Auth. APP_GUARD 등록 순서대로 실행된다.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
