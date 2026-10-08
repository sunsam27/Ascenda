import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OrganisationsService } from './organisations.service';

/**
 * Organisations Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('organisations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly service: OrganisationsService) {}

  @Get()
  findAll() {
    return { message: 'Organisations module  coming soon' };
  }
}
