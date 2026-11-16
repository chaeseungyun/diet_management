import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { PlansModule } from '../plans/plans.module';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';
import { TemplatesModule } from '../templates/templates.module';
import { WeightsModule } from '../weights/weights.module';
import { PhotosModule } from '../photos/photos.module';
import { MealsController } from './meals.controller';
import { MealsService } from './meals.service';

@Module({
  imports: [
    ProductsModule,
    TemplatesModule,
    PlansModule,
    GoalsModule,
    WeightsModule,
    StockModule,
    PhotosModule,
  ],
  controllers: [MealsController],
  providers: [MealsService],
  exports: [MealsService],
})
export class MealsModule {}
