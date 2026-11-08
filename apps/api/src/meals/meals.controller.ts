import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { MealSlot } from '@diet/shared';
import { CurrentUser } from '../auth/auth.guard';
import { DateParamPipe, IdempotencyKey, SlotParamPipe, UuidParamPipe } from '../common/validators';
import {
  CompleteDayDto,
  DayCompletionCheckDto,
  DayCompletionDto,
  DayDto,
  DaySummaryDto,
  MealRecordDto,
  PutMealRecordDto,
} from './meals.dto';
import { MealsService } from './meals.service';

const idemHeader = {
  name: 'Idempotency-Key',
  required: false,
  description: '재전송 시 저장된 응답을 돌려주고 재차감하지 않는다',
};

/** 날짜 요약·식사 기록 (api.md §8, FR-05, FR-06, D-04, D-10, S-10~S-13) */
@ApiTags('meals')
@Controller()
export class MealsController {
  constructor(private readonly meals: MealsService) {}

  @Get('days')
  @ApiOperation({ summary: '캘린더용 날짜별 요약 (최대 62일)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOkResponse({ type: DaySummaryDto, isArray: true })
  days(
    @CurrentUser() user: User,
    @Query('from', DateParamPipe) from: string,
    @Query('to', DateParamPipe) to: string,
  ): Promise<DaySummaryDto[]> {
    return this.meals.getDays(user, from, to);
  }

  @Get('days/:date')
  @ApiOperation({
    summary: '오늘 홈 한 번에: 5슬롯 계획+기록, 영양 합계·예상·목표, 추가 간식, 체중',
  })
  @ApiOkResponse({ type: DayDto })
  day(@CurrentUser() user: User, @Param('date', DateParamPipe) date: string): Promise<DayDto> {
    return this.meals.getDay(user, date);
  }

  @Get('days/:date/completion')
  @ApiOperation({
    summary:
      '완료 가능 여부·끼니 처리 현황·미기록 목록·영양 완전 예측 (S-14). 미기록 자유 끼니는 막지 않음 (D-18)',
  })
  @ApiOkResponse({ type: DayCompletionCheckDto })
  completion(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
  ): Promise<DayCompletionCheckDto> {
    return this.meals.getCompletion(user, date);
  }

  @Put('days/:date/completion')
  @ApiOperation({
    summary:
      '하루 완료. 식단 끼니 미기록·미래·가입 전 날짜는 422. skipUnrecordedFree 면 미기록 자유 끼니를 안 먹음으로 함께 저장',
  })
  @ApiOkResponse({ type: DayCompletionDto })
  complete(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Body() body: CompleteDayDto,
  ): Promise<DayCompletionDto> {
    return this.meals.complete(user, date, body);
  }

  @Delete('days/:date/completion')
  @HttpCode(204)
  @ApiOperation({ summary: '완료 해제' })
  @ApiNoContentResponse()
  uncomplete(@CurrentUser() user: User, @Param('date', DateParamPipe) date: string): Promise<void> {
    return this.meals.uncomplete(user, date);
  }

  @Get('meal-records/:date/:slot')
  @ApiOperation({ summary: '슬롯 상세. 레코드가 없으면 계획을 unrecorded·version=null 로 반환' })
  @ApiOkResponse({ type: MealRecordDto })
  record(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('slot', SlotParamPipe) slot: MealSlot,
  ): Promise<MealRecordDto> {
    return this.meals.getRecord(user, date, slot);
  }

  @Put('meal-records/:date/:slot')
  @ApiHeader(idemHeader)
  @ApiOperation({
    summary: '상태 설정 (D-04 확정). 서버가 차이로 원장을 만든다. version 불일치 409',
  })
  @ApiOkResponse({ type: MealRecordDto })
  put(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('slot', SlotParamPipe) slot: MealSlot,
    @Body() body: PutMealRecordDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<MealRecordDto> {
    return this.meals.putRecord(user, date, slot, body, idemKey);
  }

  @Post('meal-records/:date/extra')
  @HttpCode(201)
  @ApiHeader(idemHeader)
  @ApiOperation({ summary: '추가 간식 생성. 같은 날 다건, id 로 식별 (D-10)' })
  @ApiCreatedResponse({ type: MealRecordDto })
  createExtra(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Body() body: PutMealRecordDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<MealRecordDto> {
    return this.meals.createExtra(user, date, body, idemKey);
  }

  @Put('meal-records/:date/extra/:id')
  @ApiHeader(idemHeader)
  @ApiOperation({ summary: '추가 간식 수정 (version 필요)' })
  @ApiOkResponse({ type: MealRecordDto })
  updateExtra(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: PutMealRecordDto,
    @IdempotencyKey() idemKey?: string,
  ): Promise<MealRecordDto> {
    return this.meals.updateExtra(user, date, id, body, idemKey);
  }

  @Delete('meal-records/:date/extra/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '추가 간식 삭제. 차감 전량 복구' })
  @ApiNoContentResponse()
  deleteExtra(
    @CurrentUser() user: User,
    @Param('date', DateParamPipe) date: string,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<void> {
    return this.meals.deleteExtra(user, date, id);
  }
}
