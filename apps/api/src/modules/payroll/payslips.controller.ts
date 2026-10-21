import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PayslipsService } from './payslips.service';
import { ListPayslipsQueryDto } from './dto/payslip.dto';

/**
 * Payslips (PRD PAY-13). Employees read/download only their own; payroll roles
 * see the tenant. JWT + minute `payslips` permission (SELF admission) on every
 * route; the service narrows the result set by the caller's effective scope.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payslips')
export class PayslipsController {
  constructor(private readonly service: PayslipsService) {}

  @Get()
  @ApiOperation({ summary: 'List payslips visible to the caller' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async list(@Query() query: ListPayslipsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one payslip' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download a payslip as a PDF (PAY-13)' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { payslip, buffer } = await this.service.download(id);
    const filename = `payslip-${payslip.periodLabel.replace(/\s+/g, '-')}-${payslip.workerId}.pdf`;
    const encoded = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    res.end(buffer);
  }
}
