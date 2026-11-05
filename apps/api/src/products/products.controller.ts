import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import {
  BackfillResultDto,
  CreateNutritionDto,
  CreateProductDto,
  NutritionSaveResultDto,
  NutritionVersionDto,
  ProductDetailDto,
  ProductDto,
  UpdateProductDto,
} from './products.dto';
import { ProductsService } from './products.service';

/** 제품·영양 (api.md §3, FR-02, S-30~S-33) */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: '목록·검색. 영양 미등록·재고 비관리 표시' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'archived', required: false, description: 'true 면 보관 제품만' })
  @ApiOkResponse({ type: ProductDto, isArray: true })
  list(
    @CurrentUser() user: User,
    @Query('q') q?: string,
    @Query('archived') archived?: string,
  ): Promise<ProductDto[]> {
    return this.products.list(user.id, q?.trim() || undefined, archived === 'true');
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: '제품 등록. initialStock 이 있으면 초기 입고를 같은 트랜잭션에서 만든다',
  })
  @ApiCreatedResponse({ type: ProductDto })
  create(@CurrentUser() user: User, @Body() body: CreateProductDto): Promise<ProductDto> {
    return this.products.create(user.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: '상세: 현재 영양, 현재 재고, 구매 이력, 사용 중 템플릿' })
  @ApiOkResponse({ type: ProductDetailDto })
  get(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<ProductDetailDto> {
    return this.products.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '기본 정보 수정. 원장 이동이 있으면 stockUnit 변경은 422 (D-13)' })
  @ApiOkResponse({ type: ProductDto })
  update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.update(user.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: '보관. 활성 템플릿이 참조하면 422' })
  @ApiOkResponse({ type: ProductDto })
  archive(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<ProductDto> {
    return this.products.archive(user.id, id);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiOperation({ summary: '보관 해제' })
  @ApiOkResponse({ type: ProductDto })
  unarchive(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<ProductDto> {
    return this.products.unarchive(user.id, id);
  }

  @Get(':id/nutrition')
  @ApiOperation({ summary: '영양 버전 목록(현재 + 이력)' })
  @ApiOkResponse({ type: NutritionVersionDto, isArray: true })
  nutritionVersions(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<NutritionVersionDto[]> {
    return this.products.nutritionVersions(user.id, id);
  }

  @Post(':id/nutrition')
  @HttpCode(201)
  @ApiOperation({
    summary: '새 영양 버전 저장. 응답의 unknownSnapshotCount 로 D-03 보완 여부를 묻는다',
  })
  @ApiCreatedResponse({ type: NutritionSaveResultDto })
  saveNutrition(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: CreateNutritionDto,
  ): Promise<NutritionSaveResultDto> {
    return this.products.saveNutrition(user.id, id, body);
  }

  @Post(':id/nutrition/backfill')
  @HttpCode(200)
  @ApiOperation({ summary: 'D-03 2단계: 영양 미상 스냅샷만 현재 버전으로 채운다(출처 backfill)' })
  @ApiOkResponse({ type: BackfillResultDto })
  backfill(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<BackfillResultDto> {
    return this.products.backfill(user.id, id);
  }
}
