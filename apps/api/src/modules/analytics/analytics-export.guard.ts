import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { StepUpGuard } from '../../common/auth/step-up.guard';

/** Only payroll-bearing exports require the existing fresh re-authentication token. */
@Injectable()
export class AnalyticsExportGuard implements CanActivate {
  constructor(private readonly stepUp: StepUpGuard) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ query: { type?: unknown } }>();
    return ['payroll', 'pay-distribution', 'workforce-cost'].includes(String(req.query.type))
      ? this.stepUp.canActivate(context)
      : true;
  }
}
