import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (err) {
      // 운영은 DB 없이 뜨지 않는다(컨테이너 재시작에 맡긴다).
      if (process.env.NODE_ENV === 'production') throw err;
      // 개발은 DB 가 늦게 떠도 서버를 죽이지 않는다. `nest start --watch` 는 죽은 프로세스를
      // 파일이 바뀔 때까지 다시 띄우지 않기 때문이다. Prisma 가 다음 쿼리에서 다시 연결한다.
      this.logger.warn(
        'DB 에 연결하지 못했습니다. 서버는 띄워 두고 다음 쿼리에서 다시 연결합니다 (pnpm db:dev 확인).',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
