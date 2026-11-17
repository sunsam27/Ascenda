import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlanNotificationStore } from './plan-notification.store';

class AdminHistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

@ApiTags('platform-admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class PlatformAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PlanNotificationStore,
  ) {}

  @Get('session')
  @Header('Cache-Control', 'private, no-store')
  session() {
    return { platformAdmin: true };
  }

  @Get('plan-events')
  @Header('Cache-Control', 'private, no-store')
  async history(@Query() query: AdminHistoryQuery) {
    try {
      return await this.prisma.withRequestContext((tx) =>
        this.store.history(tx, query.page, query.pageSize),
      );
    } catch (error) {
      if ((error as { meta?: { code?: string } }).meta?.code === '42P01')
        throw new ServiceUnavailableException('Admin change history requires migration 04');
      throw error;
    }
  }
}
