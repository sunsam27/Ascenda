import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { RecurringPayItemsService } from './recurring-pay-items.service';
import {
  CreateRecurringPayItemDto,
  ListRecurringPayItemsQueryDto,
  UpdateRecurringPayItemDto,
} from './dto/recurring-pay-item.dto';

/**
 * Recurring deductions and employer costs (PRD PAY-02 / PAY-03). Every route
 * requires JWT + the organisation-scoped `payroll` permission.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/recurring-items')
export class RecurringPayItemsController {
  constructor(private readonly service: RecurringPayItemsService) {}

  @Get()
  @ApiOperation({ summary: 'List recurring deductions and employer costs' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListRecurringPayItemsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one recurring pay item' })
  @RequirePermission({
    resource: 'payroll',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring deduction or employer cost' })
  @RequirePermission({
    resource: 'payroll',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreateRecurringPayItemDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring pay item' })
  @RequirePermission({
    resource: 'payroll',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Param('id') id: string, @Body() dto: UpdateRecurringPayItemDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a recurring pay item' })
  @RequirePermission({
    resource: 'payroll',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
