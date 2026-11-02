import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PayoutProvider } from '@ascenda/types';
import { Public } from '../../../common/auth/public.decorator';
import { PayoutsService } from './payouts.service';

@ApiTags('payments')
@Controller('payments/webhooks')
export class PayoutWebhooksController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('paystack/:organisationId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  paystack(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.payouts.handleWebhook(
      organisationId,
      PayoutProvider.PAYSTACK,
      req.headers['x-paystack-signature'] as string | undefined,
      req.rawBody ?? Buffer.alloc(0),
    );
  }

  @Post('flutterwave/:organisationId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  flutterwave(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.payouts.handleWebhook(
      organisationId,
      PayoutProvider.FLUTTERWAVE,
      req.headers['verif-hash'] as string | undefined,
      req.rawBody ?? Buffer.alloc(0),
    );
  }
}
