import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PayrollRunsService } from './payroll-runs.service';
import {
  ApprovePayrollRunDto,
  CreatePayrollRunDto,
  ListPayrollRunsQueryDto,
  RejectPayrollRunDto,
  ReversePayrollRunDto,
  UpdatePayrollItemDto,
} from './dto/payroll-run.dto';

/**
 * Payroll runs (PRD PAY-05 … PAY-11). Every route requires JWT plus the
 * organisation-scoped `payroll` permission; approve/reject additionally
 * require `payroll:approve` (OWNER / FINANCE_APPROVER) and the preparer can
 * never approve their own run.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/runs')
export class PayrollRunsController {
  constructor(private readonly service: PayrollRunsService) {}

  @Get()
  @ApiOperation({ summary: 'List payroll runs' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListPayrollRunsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one run with its approval chain' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.get(id) };
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Item lines prepared for the run' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async items(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.items(id) };
  }

  @Get(':id/validations')
  @ApiOperation({
    summary: 'Pre-approval validation report (PAY-08 / PAY-10)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async validations(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.validations(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft run for a calendar period' })
  @RequirePermission({
    resource: 'payroll',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreatePayrollRunDto) {
    return { data: await this.service.create(dto) };
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Compute item lines and totals (proration, leave, absences)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async prepare(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.prepare(id) };
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move the run into review (DRAFT → IN_REVIEW)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async review(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.review(id) };
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({
    summary: 'Override one item line with a mandatory reason (PAY-09)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePayrollItemDto,
  ) {
    return { data: await this.service.updateItem(id, itemId, dto) };
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit for approval (blocked while validation errors exist)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async submit(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.submit(id) };
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge validation warnings before approval' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.acknowledge(id) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve the next chain step (PAY-11; preparer excluded)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePayrollRunDto,
  ) {
    return { data: await this.service.approve(id, dto) };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the run back to IN_REVIEW (audited)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayrollRunDto,
  ) {
    return { data: await this.service.reject(id, dto) };
  }

  @Post(':id/process')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create worker payments from the approved run (PAY-07)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async process(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.process(id) };
  }

  @Post(':id/lock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lock a processed run (terminal)' })
  @RequirePermission({
    resource: 'payroll',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async lock(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.lock(id) };
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reverse a post-approval run via a mirrored DRAFT (PAY-06)',
  })
  @RequirePermission({
    resource: 'payroll',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePayrollRunDto,
  ) {
    return { data: await this.service.reverse(id, dto) };
  }
}
