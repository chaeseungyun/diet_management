import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { IdempotencyKey, OptionalUuidPipe, UuidParamPipe } from '../common/validators';
import {
  AdjustmentResultDto,
  CreateAdjustmentDto,
  StockDetailDto,
  StockMovementPageDto,
  StockOverviewDto,
} from './stock.dto';
import { StockService } from './stock.service';

/** 남은 양 현황·예측·원장·맞추기 (api.md §5, FR-03, FR-08, DEC-078·080·081) */
@ApiTags('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @ApiOperation({
    summary: '식품별 남은 양·배송 중·소진 예정일·수준 배지. 보관한 식품은 빠진다 (DEC-080)',
  })
  @ApiOkResponse({ type: StockOverviewDto })
  overview(@CurrentUser() user: User): Promise<StockOverviewDto> {
    return this.stock.overview(user);
  }

  @Get(':productId')
  @ApiOperation({ summary: '식품 하나의 남은 양·소진 예정일. 보관한 식품도 조회된다' })
  @ApiOkResponse({ type: StockDetailDto })
  detail(
    @CurrentUser() user: User,
    @Param('productId', UuidParamPipe) productId: string,
  ): Promise<StockDetailDto> {
    return this.stock.detail(user, productId);
  }

  @Get(':productId/movements')
  @ApiOperation({ summary: '원장 목록(최근 것부터 30건씩). 수정·삭제는 없다(append-only)' })
  @ApiQuery({ name: 'cursor', required: false, description: '앞 쪽의 nextCursor' })
  @ApiOkResponse({ type: StockMovementPageDto })
  movements(
    @CurrentUser() user: User,
    @Param('productId', UuidParamPipe) productId: string,
    @Query('cursor', OptionalUuidPipe) cursor?: string,
  ): Promise<StockMovementPageDto> {
    return this.stock.movements(user.id, productId, cursor);
  }

  @Post(':productId/adjustments')
  @HttpCode(201)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '재전송 시 같은 응답을 돌려준다',
  })
  @ApiOperation({
    summary: '남은 양 맞추기: 실측 잔량과의 차이를 adjust 이동으로 남긴다(차이 0 도 남김)',
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
