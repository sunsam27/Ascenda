import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';

/**
 * Billing Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  findAll() {
    return { message: 'Billing module  coming soon' };
  }
}
