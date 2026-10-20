import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PayrollConfigService } from './payroll-config.service';
import { UpdatePayrollConfigDto } from './dto/payroll-config.dto';

/**
 * Payroll settings (PAY-10 / PAY-11): approval chain and validation
 * thresholds. An absent row means documented defaults.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/config')
export class PayrollConfigController {
  constructor(private readonly service: PayrollConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Effective payroll config (row or defaults)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get() {
    return { data: await this.service.get() };
  }

  @Patch()
  @ApiOperation({ summary: 'Update the approval chain and thresholds' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Body() dto: UpdatePayrollConfigDto) {
    return { data: await this.service.update(dto) };
  }
}
