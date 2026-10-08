import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TalentService } from './talent.service';

/**
 * Talent Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('talent')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('talent')
export class TalentController {
  constructor(private readonly service: TalentService) {}

  @Get()
  findAll() {
    return { message: 'Talent module  coming soon' };
  }
}
