import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { ExpenseClaimsService } from './expense-claims.service';
import {
  CreateExpenseClaimDto,
  DecideExpenseClaimDto,
  ListExpenseClaimsQueryDto,
} from './dto/expense-claim.dto';

/**
 * Reimbursements (PRD PAY-14): submit → manager review → finance approval →
 * folded into the next run. Employees act on their own claims; managers on
 * their team; finance roles on the finance step. JWT on every route.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('expense-claims')
export class ExpenseClaimsController {
  constructor(private readonly service: ExpenseClaimsService) {}

  @Get()
  @ApiOperation({ summary: 'List expense claims visible to the caller' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async list(@Query() query: ListExpenseClaimsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one expense claim' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'read',
    scope: PermissionScope.SELF,
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Submit an expense claim (PAY-14)' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'create',
    scope: PermissionScope.SELF,
  })
  async create(@Body() dto: CreateExpenseClaimDto) {
    return { data: await this.service.create(dto) };
  }

  @Post(':id/manager-decision')
  @ApiOperation({ summary: 'Manager approves or rejects a submitted claim' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'approve',
    scope: PermissionScope.TEAM,
  })
  async managerDecide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideExpenseClaimDto,
  ) {
    return { data: await this.service.managerDecide(id, dto) };
  }

  @Post(':id/finance-decision')
  @ApiOperation({ summary: 'Finance approves or rejects a manager-approved claim' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'approve',
    scope: PermissionScope.TEAM,
  })
  async financeDecide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideExpenseClaimDto,
  ) {
    return { data: await this.service.financeDecide(id, dto) };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an unpaid claim' })
  @RequirePermission({
    resource: 'expense_claims',
    action: 'update',
    scope: PermissionScope.SELF,
  })
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.cancel(id) };
  }
}
