import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';

@Module({
  imports: [AuditModule],
  controllers: [
    WorkersController,
    DepartmentsController,
    LocationsController,
    CompensationController,
  ],
  providers: [
    WorkersService,
    DepartmentsService,
    LocationsService,
    CompensationService,
  ],
  exports: [WorkersService, DepartmentsService, LocationsService, CompensationService],
})
export class PeopleModule {}
