import { Module } from '@nestjs/common';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [WorkersController, DepartmentsController, LocationsController],
  providers: [WorkersService, DepartmentsService, LocationsService],
  exports: [WorkersService, DepartmentsService, LocationsService],
})
export class PeopleModule {}
