import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { getRequestContext } from '../../../common/context/request-context';
import { SubscriptionAccessService } from './access.service';
import { OrganisationAccessDto, OrganisationQuery, PlanAccessDto } from './access.dto';
@Controller('admin/access')
@UseGuards(PlatformAdminGuard)
export class AdminSubscriptionAccessController {
  constructor(private readonly access:SubscriptionAccessService) {}
  @Get('plans') @Header('Cache-Control','private, no-store') plans(){return this.access.planPolicies();}
  @Patch('plans/:id') @UseGuards(StepUpGuard)
  plan(@Param('id',ParseUUIDPipe) id:string,@Body() dto:PlanAccessDto){return this.access.updatePolicy(id,dto);}
  @Get('organisations') @Header('Cache-Control','private, no-store')
  organisations(@Query() query:OrganisationQuery){return this.access.organisations(query.search,query.page,query.pageSize);}
  @Get('organisations/:id') @Header('Cache-Control','private, no-store')
  organisation(@Param('id',ParseUUIDPipe) id:string){return this.access.adminDetail(id);}
  @Patch('organisations/:id') @UseGuards(StepUpGuard)
  update(@Param('id',ParseUUIDPipe) id:string,@Body() dto:OrganisationAccessDto){return this.access.updateOrganisation(id,dto);}
}
@Controller('billing/access')
export class SubscriptionAccessController {
  constructor(private readonly access:SubscriptionAccessService) {}
  @Get() @Header('Cache-Control','private, no-store')
  async current(){const ctx=getRequestContext();if(!ctx?.organisationId||!ctx.userId)throw new ForbiddenException('Organisation context required');return {data:await this.access.snapshot(ctx.organisationId,ctx.userId)};}
}
