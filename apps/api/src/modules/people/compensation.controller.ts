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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { CompensationService } from './compensation.service';
import {
  CreateCompensationDto,
  UpdateCompensationDto,
} from './dto/compensation.dto';

const ORG = PermissionScope.ORGANISATION;

@ApiTags('compensation')
@ApiBearerAuth()
@Controller('workers/:workerId/compensation')
export class CompensationController {
  constructor(private readonly service: CompensationService) {}

  @Get()
  @ApiOperation({ summary: 'List a worker’s effective-dated pay history' })
  @RequirePermission({ resource: 'compensation', action: 'read', scope: ORG })
  async list(@Param('workerId') workerId: string) {
    return { data: await this.service.listForWorker(workerId) };
  }

  @Get('current')
  @ApiOperation({ summary: 'Get the pay rate in force on a given date' })
  @RequirePermission({ resource: 'compensation', action: 'read', scope: ORG })
  async current(
    @Param('workerId') workerId: string,
    @Query('asOf') asOf?: string,
  ) {
    return { data: await this.service.getCurrent(workerId, asOf) };
  }

  @Post()
  @ApiOperation({ summary: 'Add an effective-dated compensation record' })
  @RequirePermission({ resource: 'compensation', action: 'create', scope: ORG })
  async create(
    @Param('workerId') workerId: string,
    @Body() dto: CreateCompensationDto,
  ) {
    return { data: await this.service.create(workerId, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a compensation record' })
  @RequirePermission({ resource: 'compensation', action: 'update', scope: ORG })
  async update(
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompensationDto,
  ) {
    return { data: await this.service.update(workerId, id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a compensation record' })
  @RequirePermission({ resource: 'compensation', action: 'delete', scope: ORG })
  async remove(@Param('workerId') workerId: string, @Param('id') id: string) {
    await this.service.remove(workerId, id);
  }
}
