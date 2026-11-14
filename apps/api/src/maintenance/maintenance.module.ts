import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { MaintenanceService } from './maintenance.service';

/** 매일 정리 작업 (DEC-075·084) */
@Module({
  imports: [StockModule],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
