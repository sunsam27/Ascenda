import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PeopleService } from './people.service';

/**
 * People Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('people')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('people')
export class PeopleController {
  constructor(private readonly service: PeopleService) {}

  @Get()
  findAll() {
    return { message: 'People module  coming soon' };
  }
}
