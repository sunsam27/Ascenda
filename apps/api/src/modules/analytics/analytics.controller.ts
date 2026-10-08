import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get()
  findAll() {
    return { message: 'Analytics module  coming soon' };
  }
}
