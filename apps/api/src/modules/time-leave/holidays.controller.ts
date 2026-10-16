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
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { ListHolidaysQueryDto } from './dto/list-holidays.dto';

/** Public-holiday calendar (PRD LVE-03). Everyone may read; HR/admin manage. */
@ApiTags('holidays')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  @Get()
  @ApiOperation({ summary: 'List public holidays (optionally by year/location)' })
  @RequirePermission({
    resource: 'holidays',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListHolidaysQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission({
    resource: 'holidays',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a public holiday' })
  @RequirePermission({
    resource: 'holidays',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreateHolidayDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @RequirePermission({
    resource: 'holidays',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @RequirePermission({
    resource: 'holidays',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
