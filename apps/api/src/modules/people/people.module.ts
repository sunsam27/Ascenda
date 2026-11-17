import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';
import { BankAccountsController, BankLookupController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { PeopleAnalyticsReader } from './people-analytics.reader';

@Module({
  imports: [AuditModule, IdentityAccessModule, NotificationsModule],
  controllers: [
    WorkersController,
    DepartmentsController,
    LocationsController,
    CompensationController,
    BankAccountsController,
    BankLookupController,
  ],
  providers: [
    PeopleAnalyticsReader,
    WorkersService,
    DepartmentsService,
    LocationsService,
    CompensationService,
    BankAccountsService,
  ],
  exports: [WorkersService, DepartmentsService, LocationsService, CompensationService, BankAccountsService, PeopleAnalyticsReader],
})
export class PeopleModule {}
