import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { PaymentsService } from './payments.service';
import {
  ListPaymentsQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';

/**
 * Worker payments (PAY-07 process step). Created by the payroll run engine;
 * this module lists them and drives the status lifecycle (PENDING →
 * PROCESSING → COMPLETED / FAILED, with REVERSED for clawbacks). The bank
 * payment file export ships in M3.
 */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List payments (optionally by run or worker)' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListPaymentsQueryDto) {
    return this.service.list(query);
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
}
