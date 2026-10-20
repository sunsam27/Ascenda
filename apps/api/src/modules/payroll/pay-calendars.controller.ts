import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PayCalendarsService } from './pay-calendars.service';
import {
  CreatePayCalendarDto,
  ListPayCalendarsQueryDto,
  PayCalendarPeriodsQueryDto,
  UpdatePayCalendarDto,
} from './dto/pay-calendar.dto';

/**
 * Pay calendars (PRD PAY-04). Every route requires JWT + the organisation-scoped
 * `payroll` permission.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/pay-calendars')
export class PayCalendarsController {
  constructor(private readonly service: PayCalendarsService) {}

  @Get()
  @ApiOperation({ summary: 'List pay calendars' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListPayCalendarsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one pay calendar' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Get(':id/periods')
  @ApiOperation({ summary: 'Generated pay periods for a year (PAY-04)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async periods(
    @Param('id') id: string,
    @Query() query: PayCalendarPeriodsQueryDto,
  ) {
    return { data: await this.service.periods(id, query.year) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a pay calendar' })
  @RequirePermission({
    resource: 'payroll',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreatePayCalendarDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a pay calendar' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Param('id') id: string, @Body() dto: UpdatePayCalendarDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a pay calendar (refused when runs exist)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
