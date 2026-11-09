import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

/** 매일 정리 작업 (DEC-075) */
@Module({
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
