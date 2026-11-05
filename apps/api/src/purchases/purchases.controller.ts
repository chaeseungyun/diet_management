import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { PurchaseStatus, User } from '@prisma/client';
import { PURCHASE_STATUSES } from '@diet/shared';
import { CurrentUser } from '../auth/auth.guard';
import { IdempotencyKey, UuidParamPipe } from '../common/validators';
import {
  CreatePurchaseDto,
  CreateReceiptDto,
  PurchaseDto,
  ReceiptDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './purchases.dto';
import { PurchasesService } from './purchases.service';

const idemHeader = {
  name: 'Idempotency-Key',
  required: false,
  description: '재전송 시 같은 응답을 돌려주고 재입고하지 않는다',
};

/** 구매·입고 (api.md §4, FR-03, S-34, S-35) */
@ApiTags('purchases')
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('purchases')
  @ApiOperation({ summary: '구매 목록. 배송 중(ordered)은 재고 미포함' })
  @ApiQuery({ name: 'status', required: false, enum: PURCHASE_STATUSES })
  @ApiOkResponse({ type: PurchaseDto, isArray: true })
  list(@CurrentUser() user: User, @Query('status') status?: string): Promise<PurchaseDto[]> {
    if (status && !(PURCHASE_STATUSES as readonly string[]).includes(status)) {
      throw new UnprocessableEntityException('invalid status');
    }
    return this.purchases.list(user.id, status as PurchaseStatus | undefined);
  }

  @Post('purchases')
  @HttpCode(201)
  @ApiHeader(idemHeader)
  @ApiOperation({ summary: '구매 등록. received=true 면 즉시 입고' })
  @ApiCreatedResponse({ type: PurchaseDto })
  create(
    @CurrentUser() user: User,
    @Body() body: CreatePurchaseDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<PurchaseDto> {
    return this.purchases.create(user.id, body, idemKey);
  }

  @Patch('purchases/:id')
  @ApiOperation({ summary: 'ordered 상태에서만 수정' })
  @ApiOkResponse({ type: PurchaseDto })
  update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: UpdatePurchaseDto,
  ): Promise<PurchaseDto> {
    return this.purchases.update(user.id, id, body);
  }

  @Post('purchases/:id/receive')
  @HttpCode(200)
  @ApiHeader(idemHeader)
  @ApiOperation({ summary: '받았음. 입고 수량 기본 = 구매 수량 × units_per_package (D-11)' })
  @ApiOkResponse({ type: PurchaseDto })
  receive(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: ReceivePurchaseDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<PurchaseDto> {
    return this.purchases.receive(user.id, id, body, idemKey);
  }

  @Post('purchases/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'ordered 만 취소' })
  @ApiOkResponse({ type: PurchaseDto })
  cancel(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<PurchaseDto> {
    return this.purchases.cancel(user.id, id);
  }

  @Post('stock-receipts')
  @HttpCode(201)
  @ApiHeader(idemHeader)
  @ApiOperation({ summary: '구매 이력 없는 기존 보유분 초기 등록 (reason initial)' })
  @ApiCreatedResponse({ type: ReceiptDto })
  createReceipt(
    @CurrentUser() user: User,
    @Body() body: CreateReceiptDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<ReceiptDto> {
    return this.purchases.createInitialReceipt(user.id, body, idemKey);
  }
}
