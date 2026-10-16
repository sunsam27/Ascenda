import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';
import { MarkNotificationsReadDto } from './dto/mark-read.dto';

/**
 * In-app notifications for the signed-in user. Every route is SELF-scoped: the
 * service filters by `recipientUserId` (the caller), never by role.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's notifications" })
  @RequirePermission({
    resource: 'notifications',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.service.list(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count for the caller' })
  @RequirePermission({
    resource: 'notifications',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async unreadCount() {
    return { data: await this.service.unreadCount() };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all of the caller\'s notifications read' })
  @RequirePermission({
    resource: 'notifications',
    action: 'update',
    scope: PermissionScope.SELF,
  })
  async markAllRead() {
    return { data: await this.service.markAllRead() };
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark a set of notifications read' })
  @RequirePermission({
    resource: 'notifications',
    action: 'update',
    scope: PermissionScope.SELF,
  })
  async markManyRead(@Body() dto: MarkNotificationsReadDto) {
    return { data: await this.service.markManyRead(dto.ids ?? []) };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  @RequirePermission({
    resource: 'notifications',
    action: 'update',
    scope: PermissionScope.SELF,
  })
  async markRead(@Param('id') id: string) {
    return { data: await this.service.markRead(id) };
  }
}
