import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance.dto';
import { ClockAttendanceDto } from './dto/clock-attendance.dto';
import { AttendanceScheduleQueryDto } from './dto/attendance-schedule.dto';

/**
 * Attendance (PRD ATT-01/ATT-02). Employees clock in/out and read their own
 * records; managers/HR capture manual entries; the work-schedule is HR-managed.
 */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  @ApiOperation({ summary: 'List attendance records (scoped to the caller)' })
  @RequirePermission({
    resource: 'attendance',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async list(@Query() query: ListAttendanceQueryDto) {
    return this.service.list(query);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Effective work schedule (org + location) — ATT-02' })
  @RequirePermission({
    resource: 'attendance',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async schedule(@Query() query: AttendanceScheduleQueryDto) {
    return { data: await this.service.getSchedule(query) };
  }

  @Post('clock-in')
  @ApiOperation({ summary: 'Clock in (self, or a team worker) — ATT-01' })
  @RequirePermission({
    resource: 'attendance',
    action: 'create',
    scope: PermissionScope.SELF,
  })
  async clockIn(@Body() dto: ClockAttendanceDto) {
    return { data: await this.service.clockIn(dto) };
  }

  @Post('clock-out')
  @ApiOperation({ summary: 'Clock out (self, or a team worker) — ATT-01' })
  @RequirePermission({
    resource: 'attendance',
    action: 'create',
    scope: PermissionScope.SELF,
  })
  async clockOut(@Body() dto: ClockAttendanceDto) {
    return { data: await this.service.clockOut(dto) };
  }

  @Get(':id')
  @RequirePermission({
    resource: 'attendance',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Record attendance manually (manager / HR) — ATT-01' })
  @RequirePermission({
    resource: 'attendance',
    action: 'create',
    scope: PermissionScope.SELF,
  })
  async create(@Body() dto: CreateAttendanceDto) {
    return { data: await this.service.record(dto) };
  }

  @Patch(':id')
  @RequirePermission({
    resource: 'attendance',
    action: 'update',
    scope: PermissionScope.SELF,
  })
  async update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @RequirePermission({
    resource: 'attendance',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    return { data: await this.service.remove(id) };
  }
}
