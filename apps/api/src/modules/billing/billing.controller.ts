import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { IdentityAccessService } from '../identity-access/identity-access.service';
import { writeAuthCookies } from '../identity-access/auth-cookies';
import { BillingService } from './billing.service';
import { InitializeCheckoutDto, VerifyPaymentDto } from './dto/checkout.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly service: BillingService,
    private readonly auth: IdentityAccessService,
  ) {}

  /** Public: start a hosted checkout for a verified paid signup. */
  @Post('checkout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialise a payment checkout session' })
  checkout(@Body() dto: InitializeCheckoutDto) {
    return this.service.initialize(dto.registrationId, dto.provider);
  }

  /** Public: confirm payment and sign the new owner in. */
  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a payment and provision the workspace' })
  async verify(
    @Body() dto: VerifyPaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.service.verify(dto);

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
        status: outcome.status,
        completed: true,
        redirectTo: outcome.redirectTo ?? '/dashboard',
        plan: outcome.plan,
        expiresIn: session.expiresIn,
      };
    }

    return {
      status: outcome.status,
      completed: outcome.completed,
    };
  }

  @Post('webhook/paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  paystackWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.service.handlePaystackWebhook(
      req.headers['x-paystack-signature'] as string | undefined,
      req.rawBody,
    );
  }

  @Post('webhook/flutterwave')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  flutterwaveWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.service.handleFlutterwaveWebhook(
      req.headers['verif-hash'] as string | undefined,
      req.rawBody,
    );
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current subscription and recent billing activity' })
  summary() {
    return this.service.summary();
  }
}
