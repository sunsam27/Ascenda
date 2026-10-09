import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  /** Public: list active plans for the signup tier selector. */
  @Get()
  @Public()
  @ApiOperation({ summary: 'List active subscription plans' })
  async list() {
    const data = await this.service.listPublic();
    return { data };
  }

  /** Platform admin: list all plans (including archived). */
  @Get('admin')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all plans (platform admins only)' })
  async listAll() {
    const data = await this.service.listAll();
    return { data };
  }

  @Post()
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a plan' })
  create(@Body() dto: CreatePlanDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a plan (name, price, limits, features)' })
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archive a plan' })
  archive(@Param('id') id: string) {
    return this.service.archive(id);
  }
}
