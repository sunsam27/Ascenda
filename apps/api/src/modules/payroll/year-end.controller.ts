import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { YearEndService } from './year-end.service';
import {
  GenerateYearEndDto,
  ListYearEndQueryDto,
  RemittanceQueryDto,
} from './dto/year-end.dto';

/**
 * Year-end statements and statutory remittance schedules (PRD PAY-16).
 * Statements are SELF-scoped for workers and ORGANISATION-scoped for payroll
 * roles (mirroring payslips). Remittance schedules are whole-tenant reports.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/year-end')
export class YearEndController {
  constructor(private readonly service: YearEndService) {}

  @Get('statements')
  @ApiOperation({ summary: 'List year-end statements visible to the caller' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async list(@Query() query: ListYearEndQueryDto) {
    return this.service.list(query);
  }

  @Post('statements')
  @ApiOperation({ summary: 'Generate year-end statements for a tax year' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async generate(@Body() dto: GenerateYearEndDto) {
    return { data: await this.service.generateForYear(dto.year) };
  }

  @Get('remittance')
  @ApiOperation({ summary: 'Statutory remittance schedule for a tax year' })
  @RequirePermission({
    resource: 'remittance',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async remittance(@Query() query: RemittanceQueryDto) {
    return { data: await this.service.remittance(query.year) };
  }

  @Get('remittance/export')
  @ApiOperation({ summary: 'Export the remittance schedule as CSV (audited)' })
  @RequirePermission({
    resource: 'remittance',
    action: 'export',
    scope: PermissionScope.ORGANISATION,
  })
  async exportRemittance(@Query() query: RemittanceQueryDto, @Res() res: Response) {
    const file = await this.service.exportRemittance(query.year);
    const encoded = encodeURIComponent(file.filename);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(Buffer.byteLength(file.content)));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    res.end(file.content);
  }

  @Get('statements/:id')
  @ApiOperation({ summary: 'Get one year-end statement' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Get('statements/:id/pdf')
  @ApiOperation({ summary: 'Download a year-end statement PDF' })
  @RequirePermission({
    resource: 'payslips',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { statement, buffer } = await this.service.download(id);
    const filename = `year-end-${statement.taxYearLabel.replace(/\W+/g, '-')}-${statement.workerId}.pdf`;
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
