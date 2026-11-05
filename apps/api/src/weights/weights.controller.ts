import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { DateParamPipe, OptionalDateParamPipe } from '../common/validators';
import { PutWeightDto, WeightDto, WeightListDto } from './weights.dto';
import { WeightsService } from './weights.service';

/** 체중 (api.md §9, FR-07, S-50) */
@ApiTags('weights')
@Controller('weights')
export class WeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Get()
  @ApiOperation({ summary: '기간 목록 + 요약(최근 7일 평균·목표 차이·주/월 변화)' })
  @ApiOkResponse({ type: WeightListDto })
  list(
    @CurrentUser() user: User,
    @Query('from', OptionalDateParamPipe) from?: string,
    @Query('to', OptionalDateParamPipe) to?: string,
  ): Promise<WeightListDto> {
    return this.weights.list(user, from, to);
  }

  @Put(':date')
  @ApiOperation({ summary: '입력·수정. 같은 날 기록이 있으면 overwrite=true 없이는 409' })
  @ApiOkResponse({ type: WeightDto })
  put(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Body() body: PutWeightDto,
  ): Promise<WeightDto> {
    return this.weights.put(user, date, body);
  }

  @Delete(':date')
  @HttpCode(204)
  @ApiOperation({ summary: '삭제 → 미측정' })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('date', DateParamPipe) date: string): Promise<void> {
    return this.weights.remove(user, date);
  }
}
