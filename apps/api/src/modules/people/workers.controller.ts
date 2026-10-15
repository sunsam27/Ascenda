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
import { WorkersService } from './workers.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { ListWorkersQueryDto } from './dto/list-workers.dto';

const ORG = PermissionScope.ORGANISATION;

@ApiTags('workers')
@ApiBearerAuth()
@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Get()
  @ApiOperation({ summary: 'List workers (directory, search + pagination)' })
  @RequirePermission({ resource: 'workers', action: 'read', scope: ORG })
  async list(@Query() query: ListWorkersQueryDto) {
    const { data, meta } = await this.service.list(query);
    return { data, meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single worker' })
  @RequirePermission({ resource: 'workers', action: 'read', scope: ORG })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a worker' })
  @RequirePermission({ resource: 'workers', action: 'create', scope: ORG })
  async create(@Body() dto: CreateWorkerDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a worker' })
  @RequirePermission({ resource: 'workers', action: 'update', scope: ORG })
  async update(@Param('id') id: string, @Body() dto: UpdateWorkerDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a worker (soft-delete → TERMINATED)' })
  @RequirePermission({ resource: 'workers', action: 'delete', scope: ORG })
  async remove(@Param('id') id: string) {
    return { data: await this.service.terminate(id) };
  }
}
