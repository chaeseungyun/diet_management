import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  @Cron('0 4 * * *', { name: 'daily-cleanup', timeZone: 'Asia/Seoul' })
  async onCron(): Promise<void> {
    try {
      await this.cleanup(new Date());
    } catch (e) {
      this.log.error(`daily cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async cleanup(
    now: Date,
  ): Promise<{ idempotencyKeys: number; deliveries: number; alertResets: number }> {
    const keys = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
    const deliveries = await this.prisma.notificationDelivery.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    const alertResets = await this.resetDepletionAlerts(now);
    const result = { idempotencyKeys: keys.count, deliveries: deliveries.count, alertResets };
    this.log.log(
      `daily cleanup idempotencyKeys=${result.idempotencyKeys} deliveries=${result.deliveries} alertResets=${result.alertResets}`,
    );
    return result;
  }

  /**
   * 소진 알림을 보낸 식품 중 더는 소진 임박이 아닌 것의 '알렸음' 을 지운다 (DEC-084).
   * 알림 시각의 판정도 같은 일을 하지만, 소진 알림을 꺼 두었거나 그 시각에 서버가 내려가 있던 날에도
   * '다시 채웠다' 를 놓치지 않으려고 매일 한 번 더 본다. 지운 식품 수를 돌려준다.
   */
  private async resetDepletionAlerts(now: Date): Promise<number> {
    const where = { depletionAlertedAt: { not: null } };
    const before = await this.prisma.product.count({ where });
    if (before === 0) return 0;
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, products: { some: where } },
    });
    for (const user of users) {
      try {
        await this.stock.depletionAlerts(user, now);
      } catch (e) {
        this.log.error(`alert reset ${user.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return before - (await this.prisma.product.count({ where }));
  }
}
