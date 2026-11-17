import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { AnalyticsService } from './analytics.service';
import { AnalyticsReportsService } from './analytics-reports.service';
import { ReportQueryDto, ExportReportQueryDto } from './dto/report-query.dto';
import { AnalyticsExportGuard } from './analytics-export.guard';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly reports: AnalyticsReportsService,
  ) {}

  @Get('reports/catalogue')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission({ resource: 'analytics', action: 'read', scope: PermissionScope.TEAM })
  catalogue() {
    return this.reports.catalogue();
  }

  @Get('reports')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission({ resource: 'analytics', action: 'read', scope: PermissionScope.TEAM })
  async preview(@Query() query: ReportQueryDto) {
    return { data: await this.reports.preview(query) };
  }

  @Get('reports/export')
  @UseGuards(AnalyticsExportGuard)
  @RequirePermission({
    resource: 'analytics',
    action: 'export',
    scope: PermissionScope.ORGANISATION,
  })
  async export(@Query() query: ExportReportQueryDto, @Res() res: Response) {
    const file = await this.reports.export(query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', file.content.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.end(file.content);
  }

  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission({ resource: 'analytics', action: 'read', scope: PermissionScope.TEAM })
  async overview(@Query() query: OverviewQueryDto) {
    return { data: await this.service.overview(query) };
  }
}
