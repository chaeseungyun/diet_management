import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module';
import { StockModule } from '../stock/stock.module';
import { MaintenanceService } from './maintenance.service';

/** 매일 정리 작업 (DEC-075·084·087) */
@Module({
  imports: [StockModule, PhotosModule],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
