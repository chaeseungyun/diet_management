import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** 발송 기록 보관 기간 (DEC-075) */
export const DELIVERY_RETENTION_DAYS = 90;

/**
 * 매일 정리 작업 (DEC-075). 앱 안 cron 규칙(DEC-074):
 * 놓친 날은 다음 실행이 메우도록 "지금 기준 지난 것 전부" 를 지우고, 두 번 돌아도 결과가 같다.
 * 서버 시계는 UTC 이므로 시간대를 명시한다.
 */
@Injectable()
export class MaintenanceService {
  private readonly log = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *', { name: 'daily-cleanup', timeZone: 'Asia/Seoul' })
  async onCron(): Promise<void> {
    try {
      await this.cleanup(new Date());
    } catch (e) {
      this.log.error(`daily cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async cleanup(now: Date): Promise<{ idempotencyKeys: number; deliveries: number }> {
    const keys = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
    const deliveries = await this.prisma.notificationDelivery.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    const result = { idempotencyKeys: keys.count, deliveries: deliveries.count };
    this.log.log(
      `daily cleanup idempotencyKeys=${result.idempotencyKeys} deliveries=${result.deliveries}`,
    );
    return result;
  }
}
