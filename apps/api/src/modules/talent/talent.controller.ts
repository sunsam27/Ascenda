import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { TalentService } from './talent.service';
import { ListOnboardingQueryDto } from './dto/list-onboarding.dto';
import { ListOffboardingQueryDto } from './dto/list-offboarding.dto';
import { StartOffboardingDto } from './dto/start-offboarding.dto';
import { UpdateChecklistTaskDto } from './dto/update-checklist-task.dto';

const ORG = PermissionScope.ORGANISATION;

/**
 * Onboarding (ONB-01/02) and offboarding (ONB-03) lifecycle endpoints.
 * Every route is tenant-scoped and RBAC-guarded.
 */
@ApiTags('talent')
@ApiBearerAuth()
@Controller('talent')
export class TalentController {
  constructor(private readonly service: TalentService) {}

  @Get('onboarding')
  @ApiOperation({ summary: 'List onboarding checklists with progress' })
  @RequirePermission({ resource: 'onboarding', action: 'read', scope: ORG })
  async listOnboarding(@Query() query: ListOnboardingQueryDto) {
    const { data, meta } = await this.service.listOnboarding(query);
    return { data, meta };
  }

  @Get('onboarding/:workerId')
  @ApiOperation({
    summary: "Get a worker's onboarding checklist (creates it lazily)",
  })
  @RequirePermission({ resource: 'onboarding', action: 'read', scope: ORG })
  async getOnboarding(@Param('workerId') workerId: string) {
    return { data: await this.service.getOnboarding(workerId) };
  }

  @Post('onboarding/:workerId')
  @ApiOperation({ summary: "Backfill a worker's onboarding checklist" })
  @RequirePermission({ resource: 'onboarding', action: 'create', scope: ORG })
  async ensureOnboarding(@Param('workerId') workerId: string) {
    return { data: await this.service.getOnboarding(workerId) };
  }

  @Patch('onboarding/tasks/:taskId')
  @ApiOperation({ summary: 'Complete, reopen or waive an onboarding task' })
  @RequirePermission({ resource: 'onboarding', action: 'update', scope: ORG })
  async updateOnboardingTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateChecklistTaskDto,
  ) {
    return { data: await this.service.updateOnboardingTask(taskId, dto) };
  }

  @Get('offboarding')
  @ApiOperation({ summary: 'List offboarding cases with progress' })
  @RequirePermission({ resource: 'offboarding', action: 'read', scope: ORG })
  async listOffboarding(@Query() query: ListOffboardingQueryDto) {
    const { data, meta } = await this.service.listOffboarding(query);
    return { data, meta };
  }

  @Get('offboarding/:id')
  @ApiOperation({ summary: 'Get an offboarding case' })
  @RequirePermission({ resource: 'offboarding', action: 'read', scope: ORG })
  async getOffboarding(@Param('id') id: string) {
    return { data: await this.service.getOffboarding(id) };
  }

  @Post('offboarding')
  @ApiOperation({
    summary: 'Start an exit checklist and capture the exit reason',
  })
  @RequirePermission({ resource: 'offboarding', action: 'create', scope: ORG })
  async startOffboarding(@Body() dto: StartOffboardingDto) {
    return { data: await this.service.startOffboarding(dto) };
  }

  @Patch('offboarding/tasks/:taskId')
  @ApiOperation({ summary: 'Complete, reopen or waive an exit task' })
  @RequirePermission({ resource: 'offboarding', action: 'update', scope: ORG })
  async updateOffboardingTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateChecklistTaskDto,
  ) {
    return { data: await this.service.updateOffboardingTask(taskId, dto) };
  }

  @Post('offboarding/:id/complete')
  @ApiOperation({
    summary:
      'Complete the exit: set the worker to RESIGNED/TERMINATED and record the last working date',
  })
  @RequirePermission({ resource: 'offboarding', action: 'update', scope: ORG })
  async completeOffboarding(@Param('id') id: string) {
    return { data: await this.service.completeOffboarding(id) };
  }

  @Post('offboarding/:id/cancel')
  @ApiOperation({ summary: 'Cancel an in-progress offboarding case' })
  @RequirePermission({ resource: 'offboarding', action: 'update', scope: ORG })
  async cancelOffboarding(@Param('id') id: string) {
    return { data: await this.service.cancelOffboarding(id) };
  }
}
