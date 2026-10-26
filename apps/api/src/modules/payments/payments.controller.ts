import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { PermissionScope } from '@ascenda/types';
import { StepUpGuard } from '../../common/auth/step-up.guard';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PaymentsService } from './payments.service';
import {
  CancelPaymentBatchDto,
  CreatePaymentBatchDto,
  ExportPaymentsQueryDto,
  ListPaymentBatchesQueryDto,
  ListPaymentsQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';

/**
 * Worker payments (PAY-07 process step). Created by the payroll run engine;
 * this module lists them, drives the status lifecycle and assembles approved
 * bank payment batches. Exports are re-authenticated and watermarked (PAY-12).
 */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List payments (optionally by run, batch or worker)' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListPaymentsQueryDto) {
    return this.service.list(query);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List payment batches' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async listBatches(@Query() query: ListPaymentBatchesQueryDto) {
    return this.service.listBatches(query);
  }

  @Post('batches')
  @ApiOperation({ summary: 'Create a draft payment batch (PAY-12)' })
  @RequirePermission({
    resource: 'payments',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async createBatch(@Body() dto: CreatePaymentBatchDto) {
    return { data: await this.service.createBatch(dto) };
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get one payment batch' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async getBatch(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getBatch(id) };
  }

  @Post('batches/:id/approve')
  @UseGuards(StepUpGuard)
  @ApiOperation({ summary: 'Approve a payment batch (step-up required)' })
  @RequirePermission({
    resource: 'payments',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async approveBatch(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.approveBatch(id) };
  }

  @Post('batches/:id/pay')
  @UseGuards(StepUpGuard)
  @ApiOperation({ summary: 'Mark an approved batch paid (step-up required)' })
  @RequirePermission({
    resource: 'payments',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async payBatch(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.payBatch(id) };
  }

  @Post('batches/:id/cancel')
  @UseGuards(StepUpGuard)
  @ApiOperation({ summary: 'Cancel a payment batch (step-up required)' })
  @RequirePermission({
    resource: 'payments',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  async cancelBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPaymentBatchDto,
  ) {
    return { data: await this.service.cancelBatch(id, dto) };
  }

  @Get('batches/:id/export')
  @UseGuards(StepUpGuard)
  @ApiOperation({
    summary: 'Export one approved payment batch (step-up required, audited)',
  })
  @RequirePermission({
    resource: 'payments',
    action: 'export',
    scope: PermissionScope.ORGANISATION,
  })
  async exportBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    this.sendFile(res, await this.service.exportBatch(id));
  }

  @Get('export')
  @UseGuards(StepUpGuard)
  @ApiOperation({
    summary: 'Export a bank-upload payment file (step-up required, audited)',
  })
  @RequirePermission({
    resource: 'payments',
    action: 'export',
    scope: PermissionScope.ORGANISATION,
  })
  async export(@Query() query: ExportPaymentsQueryDto, @Res() res: Response) {
    this.sendFile(res, await this.service.export(query));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one payment' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.get(id) };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Move a payment through its status lifecycle (audited)',
  })
  @RequirePermission({
    resource: 'payments',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return { data: await this.service.updateStatus(id, dto) };
  }

  private sendFile(
    res: Response,
    file: { filename: string; contentType: string; content: string },
  ): void {
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
}
