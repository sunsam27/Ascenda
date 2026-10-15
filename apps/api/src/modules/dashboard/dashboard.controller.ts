import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DashboardInsights,
  type DashboardSummary,
  PermissionScope,
} from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline KPI numbers for the dashboard' })
  @RequirePermission({
    resource: 'analytics',
    action: 'read',
    scope: PermissionScope.TEAM,
  })
  async summary(): Promise<{ data: DashboardSummary }> {
    return { data: await this.service.getSummary() };
  }

  @Get('insights')
  @ApiOperation({
    summary: 'Leave, upcoming birthdays and public holidays for the insights rail',
  })
  @RequirePermission({
    resource: 'leave',
    action: 'read',
    scope: PermissionScope.TEAM,
  })
  async insights(): Promise<{ data: DashboardInsights }> {
    return { data: await this.service.getInsights() };
  }
}
