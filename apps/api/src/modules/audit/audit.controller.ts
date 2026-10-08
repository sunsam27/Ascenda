import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from './audit.service';

/**
 * Audit Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  findAll() {
    return { message: 'Audit module  coming soon' };
  }
}
