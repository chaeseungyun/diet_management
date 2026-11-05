import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { MealSlot } from '@diet/shared';
import { CurrentUser } from '../auth/auth.guard';
import { DateParamPipe, SlotParamPipe, UuidParamPipe } from '../common/validators';
import {
  BatchOverrideDto,
  BatchResultDto,
  OverrideDto,
  PutOverrideDto,
  PutPlanCellDto,
  PutWeeklyGridDto,
  ResolvedSlotDto,
  WeeklyCellDto,
  WeeklyGridDto,
} from './plans.dto';
import { PlansService } from './plans.service';

/** 주간 반복·날짜 예외 (api.md §7, FR-04, D-01, S-22~S-24) */
@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('weekly')
  @ApiOperation({ summary: '요일 7 × 슬롯 5 격자' })
  @ApiOkResponse({ type: WeeklyGridDto })
  weekly(@CurrentUser() user: User): Promise<WeeklyGridDto> {
    return this.plans.weekly(user.id);
  }

  @Put('weekly/:weekday/:slot')
  @ApiOperation({ summary: '셀 단위 설정. weekday 는 ISO 1=월 … 7=일' })
  @ApiOkResponse({ type: WeeklyCellDto })
  putWeeklyCell(
    @CurrentUser() user: User,
    @Param('weekday', ParseIntPipe) weekday: number,
    @Param('slot', SlotParamPipe) slot: MealSlot,
    @Body() body: PutPlanCellDto,
  ): Promise<WeeklyCellDto> {
    if (weekday < 1 || weekday > 7) throw new UnprocessableEntityException('weekday must be 1..7');
    return this.plans.putWeeklyCell(user.id, weekday, slot, body);
  }

  @Put('weekly')
  @ApiOperation({ summary: '격자 전체 교체(요일 복사용). 빠진 셀은 계획 없음' })
  @ApiOkResponse({ type: WeeklyGridDto })
  putWeeklyGrid(@CurrentUser() user: User, @Body() body: PutWeeklyGridDto): Promise<WeeklyGridDto> {
    return this.plans.putWeeklyGrid(user.id, body);
  }

  @Get('overrides')
  @ApiOperation({ summary: '기간 내 날짜 예외 목록 (최대 62일)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOkResponse({ type: OverrideDto, isArray: true })
  overrides(
    @CurrentUser() user: User,
    @Query('from', DateParamPipe) from: string,
    @Query('to', DateParamPipe) to: string,
  ): Promise<OverrideDto[]> {
    return this.plans.overrides(user.id, from, to);
  }

  // batch 경로는 ':date/:slot' 보다 먼저 선언해야 가려지지 않는다
  @Post('overrides/batch')
  @HttpCode(201)
  @ApiOperation({ summary: '기간·슬롯 일괄 변경(출장). batchId 로 묶음 해제 가능' })
  @ApiCreatedResponse({ type: BatchResultDto })
  batch(@CurrentUser() user: User, @Body() body: BatchOverrideDto): Promise<BatchResultDto> {
    return this.plans.batch(user.id, body);
  }

  @Delete('overrides/batch/:batchId')
  @HttpCode(204)
  @ApiOperation({ summary: '묶음 단위 해제' })
  @ApiNoContentResponse()
  deleteBatch(
    @CurrentUser() user: User,
    @Param('batchId', UuidParamPipe) batchId: string,
  ): Promise<void> {
    return this.plans.deleteBatch(user.id, batchId);
  }

  @Put('overrides/:date/:slot')
  @ApiOperation({ summary: '단일 예외 설정 (반복 계획보다 우선)' })
  @ApiOkResponse({ type: OverrideDto })
  putOverride(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('slot', SlotParamPipe) slot: MealSlot,
    @Body() body: PutOverrideDto,
  ): Promise<OverrideDto> {
    return this.plans.putOverride(user.id, date, slot, body);
  }

  @Delete('overrides/:date/:slot')
  @HttpCode(204)
  @ApiOperation({ summary: '예외 해제 → 반복 계획 복귀. 기존 기록은 불변' })
  @ApiNoContentResponse()
  deleteOverride(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('slot', SlotParamPipe) slot: MealSlot,
  ): Promise<void> {
    return this.plans.deleteOverride(user.id, date, slot);
  }

  @Get('resolved')
  @ApiOperation({ summary: '날짜·슬롯별 적용 계획(예외 우선). D-01 계산 함수를 그대로 노출' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOkResponse({ type: ResolvedSlotDto, isArray: true })
  resolved(
    @CurrentUser() user: User,
    @Query('from', DateParamPipe) from: string,
    @Query('to', DateParamPipe) to: string,
  ): Promise<ResolvedSlotDto[]> {
    return this.plans.resolved(user.id, from, to);
  }
}
