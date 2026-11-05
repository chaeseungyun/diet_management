import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { OptionalDateParamPipe } from '../common/validators';
import { CreateGoalDto, EffectiveGoalDto, GoalDto } from './goals.dto';
import { GoalsService } from './goals.service';

/** 목표 (api.md §2, FR-01, S-51) */
@ApiTags('goals')
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({ summary: '목표 이력 목록. 현재 적용 중 표시' })
  @ApiOkResponse({ type: GoalDto, isArray: true })
  list(@CurrentUser() user: User): Promise<GoalDto[]> {
    return this.goals.list(user);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '새 목표 추가. 이전 행은 이력으로 보존. 같은 시작일은 덮어쓴다' })
  @ApiCreatedResponse({ type: GoalDto })
  create(@CurrentUser() user: User, @Body() body: CreateGoalDto): Promise<GoalDto> {
    return this.goals.create(user, body);
  }

  @Get('effective')
  @ApiOperation({ summary: '특정 날짜에 적용되는 목표 (기본 오늘)' })
  @ApiOkResponse({ type: EffectiveGoalDto })
  effective(
    @CurrentUser() user: User,
    @Query('date', OptionalDateParamPipe) date?: string,
  ): Promise<EffectiveGoalDto> {
    return this.goals.effective(user, date);
  }
}
