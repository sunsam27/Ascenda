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
import { StatutoryRulePacksService } from './statutory-rule-packs.service';
import {
  CreateStatutoryRulePackDto,
  ListStatutoryRulePacksQueryDto,
  UpdateStatutoryRulePackDto,
  ValidateStatutoryRulePackDto,
} from './dto/statutory-rule-pack.dto';

/**
 * Statutory rule packs (PRD PAY-12 / LOC-02 / LOC-03). Rules are org-configured
 * data; the codebase never invents a country's rates. JWT + organisation-scoped
 * `statutory_rule_packs` permission on every route.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('payroll/statutory-rule-packs')
export class StatutoryRulePacksController {
  constructor(private readonly service: StatutoryRulePacksService) {}

  @Get()
  @ApiOperation({ summary: 'List statutory rule packs' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async list(@Query() query: ListStatutoryRulePacksQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one statutory rule pack' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'read',
    scope: PermissionScope.ORGANISATION,
  })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a statutory rule pack' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'create',
    scope: PermissionScope.ORGANISATION,
  })
  async create(@Body() dto: CreateStatutoryRulePackDto) {
    return { data: await this.service.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a statutory rule pack' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async update(@Param('id') id: string, @Body() dto: UpdateStatutoryRulePackDto) {
    return { data: await this.service.update(id, dto) };
  }

  @Patch(':id/validation')
  @ApiOperation({ summary: 'Mark a pack validated by a qualified professional (LOC-03)' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'update',
    scope: PermissionScope.ORGANISATION,
  })
  async setValidated(
    @Param('id') id: string,
    @Body() dto: ValidateStatutoryRulePackDto,
  ) {
    return { data: await this.service.setValidated(id, dto.validated ?? true) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a statutory rule pack' })
  @RequirePermission({
    resource: 'statutory_rule_packs',
    action: 'delete',
    scope: PermissionScope.ORGANISATION,
  })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
