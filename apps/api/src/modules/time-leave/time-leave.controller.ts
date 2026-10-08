import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TimeLeaveService } from './time-leave.service';

/**
 * TimeLeave Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('time-leave')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('time-leave')
export class TimeLeaveController {
  constructor(private readonly service: TimeLeaveService) {}

  @Get()
  findAll() {
    return { message: 'TimeLeave module  coming soon' };
  }
}
