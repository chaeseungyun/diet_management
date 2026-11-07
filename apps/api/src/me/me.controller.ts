import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from '../config/env';
import { SESSION_COOKIE, clearCookie } from '../common/cookies';
import { MeDto, UpdateMeDto } from './me.dto';

/** 계정 (FR-01, NFR-04, S-70, S-73). 항상 세션 사용자 자신만 다룬다. */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ApiOperation({ summary: '프로필·시간대·온보딩 완료 여부' })
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: User): MeDto {
    return MeDto.from(user);
  }

  @Patch()
  @ApiOperation({ summary: '닉네임·시간대·쓰는 끼니 수정, 온보딩 완료 표시' })
  @ApiOkResponse({ type: MeDto })
  async update(@CurrentUser() user: User, @Body() body: UpdateMeDto): Promise<MeDto> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.onboarded === true && !user.onboardedAt ? { onboardedAt: new Date() } : {}),
        ...(body.activeSlots !== undefined ? { activeSlots: body.activeSlots } : {}),
      },
    });
    // TODO(단계 2): 시간대 변경 시 pending 알림 재예약 (api.md §1)
    return MeDto.from(updated);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: '계정 소프트 삭제. 이후 로그인·요청 거부. 개인 데이터 삭제 절차는 운영 문서',
  })
  async remove(@CurrentUser() user: User, @Res() res: Response): Promise<void> {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    clearCookie(res, SESSION_COOKIE, this.env.cookieSecure);
    res.status(204).end();
  }
}
