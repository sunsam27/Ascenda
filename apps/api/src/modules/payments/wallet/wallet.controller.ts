import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../../common/rbac/permission.decorator';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { Public } from '../../../common/auth/public.decorator';
import { EmployerWalletService } from './wallet.service';
import { EmployerWalletSetupDto, WalletPageDto, WalletSubmissionDto } from './wallet.dto';

@Controller('payments/employer-wallet')
@UseGuards(AuthGuard('jwt'))
export class EmployerWalletController {
  constructor(private readonly wallets: EmployerWalletService) {}

  @Get()
  @RequirePermission({ resource: 'payments', action: 'read', scope: PermissionScope.ORGANISATION })
  summary() { return this.wallets.summary(); }

  @Post('setup')
  @UseGuards(StepUpGuard)
  @RequirePermission({ resource: 'settings', action: 'update', scope: PermissionScope.ORGANISATION })
  setup(@Body() dto: EmployerWalletSetupDto) { return this.wallets.setup(dto); }

  @Post('setup/status')
  @UseGuards(StepUpGuard)
  @RequirePermission({ resource: 'settings', action: 'update', scope: PermissionScope.ORGANISATION })
  setupStatus() { return this.wallets.syncSetup(); }

  @Get('ledger')
  @RequirePermission({ resource: 'payments', action: 'read', scope: PermissionScope.ORGANISATION })
  ledger(@Query() query: WalletPageDto) { return this.wallets.ledger(query); }

  @Get('history')
  @RequirePermission({ resource: 'payments', action: 'read', scope: PermissionScope.ORGANISATION })
  history(@Query() query: WalletPageDto) { return this.wallets.history(query); }

  @Get('batches/:id/quote')
  @RequirePermission({ resource: 'payments', action: 'read', scope: PermissionScope.ORGANISATION })
  quote(@Param('id', ParseUUIDPipe) id: string) { return this.wallets.quote(id); }

  @Get('batches/:id/retry-quote')
  @RequirePermission({ resource: 'payments', action: 'read', scope: PermissionScope.ORGANISATION })
  retryQuote(@Param('id', ParseUUIDPipe) id: string) { return this.wallets.quote(id, true); }

  @Post('batches/:id/pay')
  @UseGuards(StepUpGuard)
  @RequirePermission({ resource: 'payments', action: 'approve', scope: PermissionScope.ORGANISATION })
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WalletSubmissionDto) { return this.wallets.submit(id, dto); }

  @Post('batches/:id/retry')
  @UseGuards(StepUpGuard)
  @RequirePermission({ resource: 'payments', action: 'approve', scope: PermissionScope.ORGANISATION })
  retry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WalletSubmissionDto) { return this.wallets.submit(id, dto, true); }

  @Post('reconcile')
  @RequirePermission({ resource: 'payments', action: 'approve', scope: PermissionScope.ORGANISATION })
  reconcile() { return this.wallets.reconcile(); }
}

// Separate from the authenticated controller; the adapter must authenticate the
// webhook and re-query transaction evidence before the service will credit it.
@Controller('payments/employer-wallet/webhooks')
export class EmployerWalletWebhooksController {
  constructor(private readonly wallets: EmployerWalletService) {}

  @Public()
  @Post(':organisationId')
  @HttpCode(200)
  webhook(@Param('organisationId', ParseUUIDPipe) organisationId: string, @Req() req: RawBodyRequest<Request>) {
    return this.wallets.webhook(organisationId, req.rawBody ?? Buffer.alloc(0), req.headers);
  }
}
