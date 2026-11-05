import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { UuidParamPipe } from '../common/validators';
import { PutTemplateDto, TemplateDto } from './templates.dto';
import { TemplatesService } from './templates.service';

/** 식단 템플릿 (api.md §6, FR-04, S-20, S-21) */
@ApiTags('meal-templates')
@Controller('meal-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: '목록. 1회 영양 합계(불완전 표시), 사용 중인 셀 수' })
  @ApiQuery({ name: 'archived', required: false })
  @ApiOkResponse({ type: TemplateDto, isArray: true })
  list(@CurrentUser() user: User, @Query('archived') archived?: string): Promise<TemplateDto[]> {
    return this.templates.list(user, archived === 'true');
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '생성. 타인 제품은 404, 허용되지 않는 단위는 422' })
  @ApiCreatedResponse({ type: TemplateDto })
  create(@CurrentUser() user: User, @Body() body: PutTemplateDto): Promise<TemplateDto> {
    return this.templates.create(user, body);
  }

  @Get(':id')
  @ApiOkResponse({ type: TemplateDto })
  get(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<TemplateDto> {
    return this.templates.get(user, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '이름·품목 전체 교체. 과거 스냅샷 불변' })
  @ApiOkResponse({ type: TemplateDto })
  replace(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: PutTemplateDto,
  ): Promise<TemplateDto> {
    return this.templates.replace(user, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: '보관. 주간 계획·예정 예외가 참조하면 422' })
  @ApiOkResponse({ type: TemplateDto })
  archive(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<TemplateDto> {
    return this.templates.archive(user, id);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiOkResponse({ type: TemplateDto })
  unarchive(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<TemplateDto> {
    return this.templates.unarchive(user, id);
  }
}
