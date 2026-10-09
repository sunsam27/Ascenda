import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { AuditLog } from '@ascenda/db';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List the current organisation audit trail' })
  @RequirePermission({
    resource: 'audit_logs',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async findAll(@Query('limit') limit?: string): Promise<{ data: AuditLog[] }> {
    const data = await this.service.findAll(limit ? Number(limit) : 50);
    return { data };
  }
}
