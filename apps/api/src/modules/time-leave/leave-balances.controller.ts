import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { LeaveBalancesService } from './leave-balances.service';
import { ListLeaveBalancesQueryDto } from './dto/list-leave-balances.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';
import { RunLeaveAccrualDto } from './dto/run-leave-accrual.dto';

@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly service: LeaveBalancesService) {}

  @Get()
  @RequirePermission({ resource: 'leave', action: 'read', scope: PermissionScope.SELF })
  async list(@Query() query: ListLeaveBalancesQueryDto) {
    return this.service.list(query);
  }

  @Post('adjust')
  @RequirePermission({ resource: 'leave', action: 'update', scope: PermissionScope.ORGANISATION })
  async adjust(@Body() dto: AdjustLeaveBalanceDto) {
    return { data: await this.service.adjust(dto) };
  }

  @Post('accrual/run')
  @RequirePermission({ resource: 'leave', action: 'update', scope: PermissionScope.ORGANISATION })
  async runAccrual(@Body() dto: RunLeaveAccrualDto) {
    return { data: await this.service.runAccrual(dto) };
  }
}
