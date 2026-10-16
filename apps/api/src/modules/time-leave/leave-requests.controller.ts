import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { DelegateLeaveRequestDto } from './dto/delegate-leave-request.dto';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests.dto';
import { LeaveCalendarQueryDto } from './dto/leave-calendar-query.dto';

@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly service: LeaveRequestsService) {}

  @Get()
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async list(@Query() query: ListLeaveRequestsQueryDto) {
    return this.service.list(query);
  }

  @Get('calendar')
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async calendar(@Query() query: LeaveCalendarQueryDto) {
    return { data: await this.service.calendar(query) };
  }

  @Post('escalations/run')
  @RequirePermission({ resource: 'leave', action: 'approve', scope: PermissionScope.ORGANISATION })
  async runEscalations() {
    return { data: await this.service.escalateOverdue() };
  }

  @Get(':id')
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @RequirePermission({ resource: 'leave', action: 'create', scope: PermissionScope.SELF })
  async create(@Body() dto: CreateLeaveRequestDto) {
    return { data: await this.service.create(dto) };
  }

  @Post(':id/submit')
  @RequirePermission({ resource: 'leave', action: 'create', scope: PermissionScope.SELF })
  async submit(@Param('id') id: string) {
    return { data: await this.service.submit(id) };
  }

  @Post(':id/decide')
  @RequirePermission({ resource: 'leave', action: 'approve', scope: PermissionScope.TEAM })
  async decide(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return { data: await this.service.decide(id, dto) };
  }

  @Post(':id/delegate')
  @RequirePermission({ resource: 'leave', action: 'approve', scope: PermissionScope.TEAM })
  async delegate(@Param('id') id: string, @Body() dto: DelegateLeaveRequestDto) {
    return { data: await this.service.delegate(id, dto) };
  }

  @Post(':id/cancel')
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async cancel(@Param('id') id: string) {
    return { data: await this.service.cancel(id) };
  }
}
