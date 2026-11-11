import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { IdempotencyKey, UuidParamPipe } from '../common/validators';
import { AdjustmentResultDto, CreateAdjustmentDto } from './stock.dto';
import { StockService } from './stock.service';

/** 재고 (api.md §5). 단계 2 의 조회·예측은 아직이고 실측 잔량 보정만 있다 (DEC-078) */
@ApiTags('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post(':productId/adjustments')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '재전송 시 같은 응답을 돌려준다',
  })
  @ApiOperation({
    summary: '남은 양 맞추기: 실측 잔량과 현재 합계의 차이만큼 adjust 이동 (차이 0 이면 이동 없음)',
  })
  @ApiCreatedResponse({ type: AdjustmentResultDto })
  adjust(
    @CurrentUser() user: User,
    @Param('productId', UuidParamPipe) productId: string,
    @Body() body: CreateAdjustmentDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<AdjustmentResultDto> {
    return this.stock.adjust(user.id, productId, body, idemKey);
  }
}
