import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/** 상태 확인 (NFR-05). 비인증. DB 연결까지 확인하고 실패면 503. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '프로세스·DB 상태' })
  async check(): Promise<{ status: 'ok'; db: 'ok'; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
    return { status: 'ok', db: 'ok', time: new Date().toISOString() };
  }
}
