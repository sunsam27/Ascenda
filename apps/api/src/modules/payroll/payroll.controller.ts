import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PayrollService } from './payroll.service';
import { PayrollPreviewQueryDto } from './dto/payroll-preview-query.dto';

/**
 * Payroll Controller
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get()
  findAll() {
    return { message: 'Payroll module  coming soon' };
  }

  @Get('preview')
  @ApiOperation({
    summary: 'Read-only payroll preview (prorated base + absence deductions)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async preview(@Query() query: PayrollPreviewQueryDto) {
    return { data: await this.service.preview(query) };
  }
}
