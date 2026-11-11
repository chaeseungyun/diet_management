import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  imports: [ProductsModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
