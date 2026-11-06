import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { RequirePermission } from '../../../common/rbac/permission.decorator';
import { SavePayoutAccountDto } from '../dto/payment.dto';
import { PayoutsService } from './payouts.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(AuthGuard('jwt'))
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('payout-options')
  @ApiOperation({ summary: 'List payout providers and supported currencies' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  options() {
    return this.payouts.getOptions();
  }

  @Get('payout-account')
  @ApiOperation({ summary: 'Get the organisation payout account (masked)' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async account() {
    return { account: await this.payouts.getAccount() };
  }

  @Put('payout-account')
  @UseGuards(StepUpGuard)
  @ApiOperation({
    summary: 'Connect or replace the organisation payout account (step-up)',
  })
  @RequirePermission({
    resource: 'settings',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  save(@Body() dto: SavePayoutAccountDto) {
    return this.payouts.saveAccount(dto);
  }

  @Post('payout-account/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh the provider wallet balance' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  refreshBalance() {
    return this.payouts.refreshBalance();
  }

  @Delete('payout-account')
  @UseGuards(StepUpGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect the payout account (step-up)' })
  @RequirePermission({
    resource: 'settings',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  disconnect(): Promise<void> {
    return this.payouts.disconnectAccount();
  }

  @Get('batches/:id/payouts')
  @ApiOperation({ summary: 'List the payout attempts in a batch' })
  @RequirePermission({
    resource: 'payments',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  batchPayouts(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.getBatchPayouts(id);
  }

  @Post('batches/:id/payout')
  @UseGuards(StepUpGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an approved batch through the connected payout account',
  })
  @RequirePermission({
    resource: 'payments',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  initiate(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.initiateBatch(id);
  }

  @Post('batches/:id/payout/retry')
  @UseGuards(StepUpGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry only the failed transfers in a terminal batch',
  })
  @RequirePermission({
    resource: 'payments',
    action: 'approve',
    scope: PermissionScope.ORGANISATION,
  })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.retryBatchPayouts(id);
  }
}
