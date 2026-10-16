import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { BlackoutPeriodsService } from './blackout-periods.service';
import { CreateBlackoutPeriodDto } from './dto/create-blackout-period.dto';
import { UpdateBlackoutPeriodDto } from './dto/update-blackout-period.dto';
import { ListBlackoutPeriodsQueryDto } from './dto/list-blackout-periods.dto';

/** Blackout periods (PRD LVE-05). Readable by all members; HR-managed. */
@ApiTags('blackout-periods')
@ApiBearerAuth()
@Controller('blackout-periods')
export class BlackoutPeriodsController {
  constructor(private readonly service: BlackoutPeriodsService) {}

  @Get()
  @ApiOperation({ summary: 'List blackout periods' })
  @RequirePermission({
    resource: 'blackout_periods',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListBlackoutPeriodsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission({
    resource: 'blackout_periods',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a blackout window (HR)' })
  @RequirePermission({
    resource: 'blackout_periods',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreateBlackoutPeriodDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @RequirePermission({
    resource: 'blackout_periods',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Param('id') id: string, @Body() dto: UpdateBlackoutPeriodDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @RequirePermission({
    resource: 'blackout_periods',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
