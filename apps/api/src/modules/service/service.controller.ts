import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ServiceService } from './service.service';

/**
 * Service Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('service')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('service')
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

  @Get()
  findAll() {
    return { message: 'Service module  coming soon' };
  }
}
