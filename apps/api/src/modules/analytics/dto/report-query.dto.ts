import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  ANALYTICS_REPORT_TYPES,
  type AnalyticsReportType,
  type AnalyticsExportFormat,
} from '@ascenda/types';
import { OverviewQueryDto } from './overview-query.dto';

export class ReportQueryDto extends OverviewQueryDto {
  @IsIn(ANALYTICS_REPORT_TYPES)
  type!: AnalyticsReportType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class ExportReportQueryDto extends OverviewQueryDto {
  @IsIn(ANALYTICS_REPORT_TYPES)
  type!: AnalyticsReportType;

  @IsIn(['csv', 'pdf'])
  format!: AnalyticsExportFormat;
}
