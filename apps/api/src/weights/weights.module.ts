import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { WeightsController } from './weights.controller';
import { WeightsService } from './weights.service';

@Module({
  imports: [GoalsModule],
  controllers: [WeightsController],
  providers: [WeightsService],
  exports: [WeightsService],
})
export class WeightsModule {}
