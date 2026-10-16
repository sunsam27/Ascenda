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
import { LeaveTypesService } from './leave-types.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { ListLeaveTypesQueryDto } from './dto/list-leave-types.dto';

/** Leave type catalogue (PRD LVE-01). Read is open to everyone who can take
 * leave; changes are limited to HR administrators and owners. */
@ApiTags('leave-types')
@ApiBearerAuth()
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly service: LeaveTypesService) {}

  @Get()
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async list(@Query() query: ListLeaveTypesQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @RequirePermission({ resource: 'leave', action: 'create', scope: PermissionScope.ORGANISATION })
  async create(@Body() dto: CreateLeaveTypeDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @RequirePermission({ resource: 'leave', action: 'update', scope: PermissionScope.ORGANISATION })
  async update(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @RequirePermission({ resource: 'leave', action: 'delete', scope: PermissionScope.ORGANISATION })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
