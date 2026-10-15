import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const ORG = PermissionScope.ORGANISATION;

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List departments' })
  @RequirePermission({ resource: 'departments', action: 'read', scope: ORG })
  async list() {
    return { data: await this.service.list() };
  }

  @Post()
  @ApiOperation({ summary: 'Create a department' })
  @RequirePermission({ resource: 'departments', action: 'create', scope: ORG })
  async create(@Body() dto: CreateDepartmentDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a department' })
  @RequirePermission({ resource: 'departments', action: 'update', scope: ORG })
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a department' })
  @RequirePermission({ resource: 'departments', action: 'delete', scope: ORG })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
