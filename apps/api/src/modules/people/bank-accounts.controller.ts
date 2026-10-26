import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { BankAccountsService } from './bank-accounts.service';
import {
  CreateBankAccountDto,
  DetectBankDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';
import {
  detectBankFromAccountNumber,
  NG_BANKS,
} from './domain/bank-detect';

const SELF = PermissionScope.SELF;

/**
 * Bank accounts are readable/writable by org payroll admins (any worker) and by
 * employees for their own record. The RBAC guard admits on any of the applicable
 * scopes; the service then enforces the SELF restriction. Employees therefore
 * carry `bank_accounts:read/create/update @ SELF`.
 */
@ApiTags('bank-accounts')
@ApiBearerAuth()
@Controller('workers/:workerId/bank-accounts')
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  @ApiOperation({ summary: "List a worker's bank accounts (masked)" })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'read',
    scope: SELF,
  })
  async list(@Param('workerId') workerId: string) {
    return { data: await this.service.listForWorker(workerId) };
  }

  @Get('primary')
  @ApiOperation({ summary: "A worker's primary bank account (masked)" })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'read',
    scope: SELF,
  })
  async primary(@Param('workerId') workerId: string) {
    return { data: await this.service.getPrimary(workerId) };
  }

  @Post()
  @ApiOperation({ summary: 'Add a bank account for a worker' })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'create',
    scope: SELF,
  })
  async create(
    @Param('workerId') workerId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return { data: await this.service.create(workerId, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a bank account' })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'update',
    scope: SELF,
  })
  async update(
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return { data: await this.service.update(workerId, id, dto) };
  }

  @Post(':id/review')
  @ApiOperation({
    summary: 'Payroll marks changed bank details as reviewed',
  })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'update',
    scope: SELF,
  })
  async review(
    @Param('workerId') workerId: string,
    @Param('id') id: string,
  ) {
    return { data: await this.service.review(workerId, id) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a bank account' })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'update',
    scope: SELF,
  })
  async remove(@Param('workerId') workerId: string, @Param('id') id: string) {
    await this.service.remove(workerId, id);
  }
}

/** Static reference data + account-number bank detection (no worker scope). */
@ApiTags('bank-accounts')
@ApiBearerAuth()
@Controller('bank-accounts')
export class BankLookupController {
  @Get('banks')
  @ApiOperation({ summary: 'Static Nigerian bank list for the picker' })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'read',
    scope: SELF,
  })
  banks() {
    return { data: NG_BANKS };
  }

  @Post('detect')
  @ApiOperation({ summary: 'Best-effort resolve a bank from an account number' })
  @RequirePermission({
    resource: 'bank_accounts',
    action: 'read',
    scope: SELF,
  })
  detect(@Body() dto: DetectBankDto) {
    return { data: detectBankFromAccountNumber(dto.accountNumber) };
  }
}

