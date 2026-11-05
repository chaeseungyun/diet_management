import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** 모든 업무 모듈이 쓰는 공통 서비스 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class CommonModule {}
