import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { IdentityAccessService } from '../identity-access/identity-access.service';
import { writeAuthCookies } from '../identity-access/auth-cookies';
import { RegistrationsService } from './registrations.service';
import { StartRegistrationDto } from './dto/start-registration.dto';
import {
  ResendVerificationDto,
  VerifyRegistrationDto,
} from './dto/verify-registration.dto';

@ApiTags('signups')
@Controller('signups')
export class RegistrationsController {
  constructor(
    private readonly service: RegistrationsService,
    private readonly auth: IdentityAccessService,
  ) {}

  /** Public: begin a workspace signup and email a verification code. */
  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Start a self-serve workspace signup' })
  start(@Body() dto: StartRegistrationDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.service.start(dto, {
      ipAddress: req.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }

  /** Public: resend the 6-digit verification code. */
  @Post('resend')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Resend the workspace verification code' })
  resend(@Body() dto: ResendVerificationDto) {
    return this.service.resend(dto.registrationId);
  }

  /** Public: verify the code; free plans sign in immediately. */
  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a signup code' })
  async verify(
    @Body() dto: VerifyRegistrationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.service.verify(
      dto.registrationId,
      dto.code,
    );

    if (outcome.workspace) {
      const session = this.auth.issueSessionForOwner({
        user: {
          id: outcome.workspace.userId,
          email: outcome.workspace.email,
          firstName: outcome.workspace.firstName,
          lastName: outcome.workspace.lastName,
          avatarUrl: null,
          isMfaEnabled: false,
          isPlatformAdmin: outcome.workspace.isPlatformAdmin,
        },
        organisationId: outcome.workspace.organisationId,
        role: outcome.workspace.role,
      });
      writeAuthCookies(res, session);
      return {
        completed: true,
        redirectTo: outcome.redirectTo ?? '/dashboard',
        plan: outcome.plan,
        expiresIn: session.expiresIn,
      };
    }

    return {
      completed: false,
      requiresPayment: outcome.requiresPayment,
      plan: outcome.plan,
    };
  }

  /** Platform admin: list signups for oversight. */
  @Get()
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List workspace signups (platform admins only)' })
  async list() {
    const data = await this.service.list();
    return { data };
  }
}
