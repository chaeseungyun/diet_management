import { DynamicModule, Global, Module } from '@nestjs/common';
import { ENV, type Env } from './env';

/** 검증된 환경 변수를 ENV 토큰으로 전역 제공한다. 테스트는 다른 Env 를 넣을 수 있다. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
