import { Module } from '@nestjs/common';
import { MailerModule } from '../../common/mailer/mailer.module';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuditModule } from '../audit/audit.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [AuditModule, MailerModule, IdentityAccessModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, PlatformAdminGuard],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
