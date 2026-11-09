import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { HealthController } from './health/health.controller';
import { GoalsModule } from './goals/goals.module';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { TemplatesModule } from './templates/templates.module';
import { PlansModule } from './plans/plans.module';
import { MealsModule } from './meals/meals.module';
import { WeightsModule } from './weights/weights.module';
import { StatsModule } from './stats/stats.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        PrismaModule,
        CommonModule,
        AuthModule,
        MeModule,
        // 단계 1 (api.md §13)
        GoalsModule,
        ProductsModule,
        PurchasesModule,
        TemplatesModule,
        PlansModule,
        MealsModule,
        WeightsModule,
        // 단계 2
        StatsModule,
        NotificationsModule,
      ],
      controllers: [HealthController],
    };
  }
}
