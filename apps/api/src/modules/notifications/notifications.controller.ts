import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';

/**
 * Notifications Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  findAll() {
    return { message: 'Notifications module  coming soon' };
  }
}
