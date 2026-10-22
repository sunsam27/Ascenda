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
import { ImportWorkersDto } from './dto/import-workers.dto';

const ORG = PermissionScope.ORGANISATION;
const TEAM = PermissionScope.TEAM;
const SELF = PermissionScope.SELF;

@ApiTags('workers')
@ApiBearerAuth()
@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Get()
  @ApiOperation({ summary: 'List workers (directory, search + pagination)' })
  @RequirePermission({ resource: 'workers', action: 'read', scope: TEAM })
  async list(@Query() query: ListWorkersQueryDto) {
    const { data, meta } = await this.service.list(query);
    return { data, meta };
  }

  @Get('me')
  @ApiOperation({ summary: "The signed-in employee's own worker profile" })
  @RequirePermission({ resource: 'workers', action: 'read', scope: SELF })
  async me() {
    return { data: await this.service.me() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single worker' })
  @RequirePermission({ resource: 'workers', action: 'read', scope: TEAM })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a worker' })
  @RequirePermission({ resource: 'workers', action: 'create', scope: ORG })
  async create(@Body() dto: CreateWorkerDto) {
    return { data: await this.service.create(dto) };
  }

  @Post('import/preview')
  @ApiOperation({ summary: 'Validate a worker CSV without writing' })
  @RequirePermission({ resource: 'workers', action: 'create', scope: ORG })
  async previewImport(@Body() dto: ImportWorkersDto) {
    return { data: await this.service.previewImport(dto.csv) };
  }

  @Post('import')
  @ApiOperation({ summary: 'Import workers from a CSV' })
  @RequirePermission({ resource: 'workers', action: 'create', scope: ORG })
  async commitImport(@Body() dto: ImportWorkersDto) {
    return { data: await this.service.commitImport(dto.csv) };
  }

  @Post(':id/invite')
  @ApiOperation({ summary: 'Email a workspace login invitation to a worker' })
  @RequirePermission({ resource: 'workers', action: 'update', scope: ORG })
  async invite(@Param('id') id: string) {
    return { data: await this.service.invite(id) };
  }

  @Post(':id/invite/resend')
  @ApiOperation({
    summary: 'Re-send a workspace invitation (supersedes the previous link)',
  })
  @RequirePermission({ resource: 'workers', action: 'update', scope: ORG })
  async resendInvite(@Param('id') id: string) {
    return { data: await this.service.invite(id) };
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
