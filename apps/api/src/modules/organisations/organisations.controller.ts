import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { Organisation } from '@ascenda/db';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { OrganisationsService } from './organisations.service';

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
}
