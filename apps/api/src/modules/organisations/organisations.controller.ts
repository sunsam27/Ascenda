import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { Organisation } from '@ascenda/db';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { OrganisationsService } from './organisations.service';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';

@ApiTags('organisations')
@ApiBearerAuth()
@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly service: OrganisationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get the organisations the caller can access' })
  @RequirePermission({
    resource: 'organisations',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async findAll(): Promise<{ data: Organisation[] }> {
    const data = await this.service.getCurrent();
    return { data };
  }

  @Patch()
  @ApiOperation({ summary: "Update the caller's organisation (setup flow)" })
  @RequirePermission({
    resource: 'organisations',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(
    @Body() dto: UpdateOrganisationDto,
  ): Promise<{ data: Organisation }> {
    const data = await this.service.update(dto);
    return { data };
  }

  @Put()
  @ApiOperation({ summary: "Update the caller's organisation (setup flow)" })
  @RequirePermission({
    resource: 'organisations',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async replace(
    @Body() dto: UpdateOrganisationDto,
  ): Promise<{ data: Organisation }> {
    const data = await this.service.update(dto);
    return { data };
  }
}
