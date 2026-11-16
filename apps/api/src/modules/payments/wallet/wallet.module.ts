import { Module } from '@nestjs/common';
import { EmployerWalletController, EmployerWalletWebhooksController } from './wallet.controller';
import { EmployerWalletService } from './wallet.service';
import { EmployerFundingRegistry } from './wallet-provider';
import { AuditModule } from '../../audit/audit.module';
import { IdentityAccessModule } from '../../identity-access/identity-access.module';

@Module({
  imports: [AuditModule, IdentityAccessModule],
  controllers: [EmployerWalletController, EmployerWalletWebhooksController],
  providers: [EmployerWalletService, EmployerFundingRegistry],
  exports: [EmployerWalletService, EmployerFundingRegistry],
})
export class EmployerWalletModule {}
