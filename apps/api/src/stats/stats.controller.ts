import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { DateParamPipe } from '../common/validators';
import { StatsDailyDto, StatsSummaryDto } from './stats.dto';
import { StatsService } from './stats.service';

/** 통계 (api.md §10, FR-06, FR-07, S-60). 조회 시 계산, 최대 366일 */
@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      '기록 완료율·연속 기록·영양 평균(완료 + 지표 완전인 날만)·목표 달성일·체중 변화·계획 실천율',
  })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOkResponse({ type: StatsSummaryDto })
  summary(
    @CurrentUser() user: User,
    @Query('from', DateParamPipe) from: string,
    @Query('to', DateParamPipe) to: string,
  ): Promise<StatsSummaryDto> {
    return this.stats.summary(user, from, to);
  }

  @Get('daily')
  @ApiOperation({ summary: '일별 영양(기록된 합계 + 지표별 완전 여부)·완료·당시 목표·체중' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOkResponse({ type: StatsDailyDto })
  daily(
    @CurrentUser() user: User,
    @Query('from', DateParamPipe) from: string,
    @Query('to', DateParamPipe) to: string,
  ): Promise<StatsDailyDto> {
    return this.stats.daily(user, from, to);
  }
}
