import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PaymentsService } from './payments.service';

/**
 * Payments Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  findAll() {
    return { message: 'Payments module  coming soon' };
  }
}
