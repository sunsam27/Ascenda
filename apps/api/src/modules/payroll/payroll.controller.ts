import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PayrollService } from './payroll.service';

/**
 * Payroll Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get()
  findAll() {
    return { message: 'Payroll module  coming soon' };
  }
}
