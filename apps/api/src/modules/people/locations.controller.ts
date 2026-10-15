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
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const ORG = PermissionScope.ORGANISATION;

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'List locations' })
  @RequirePermission({ resource: 'locations', action: 'read', scope: ORG })
  async list() {
    return { data: await this.service.list() };
  }

  @Post()
  @ApiOperation({ summary: 'Create a location' })
  @RequirePermission({ resource: 'locations', action: 'create', scope: ORG })
  async create(@Body() dto: CreateLocationDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a location' })
  @RequirePermission({ resource: 'locations', action: 'update', scope: ORG })
  async update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a location' })
  @RequirePermission({ resource: 'locations', action: 'delete', scope: ORG })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
