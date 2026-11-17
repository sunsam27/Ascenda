import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { SubscriptionAccessService } from './access.service';
import { isHistoricalRead, routeFeature } from './access.domain';
@Injectable()
export class SubscriptionFeatureGuard implements CanActivate {
  constructor(private readonly access:SubscriptionAccessService,private readonly reflector:Reflector,private readonly config:ConfigService) {}
  async canActivate(context:ExecutionContext):Promise<boolean> {
    if(!this.access.enabled()||this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY,[context.getHandler(),context.getClass()]))return true;
    const req=context.switchToHttp().getRequest<{path:string;method:string;user?:{sub?:string;organisationId?:string}}>();
    const prefix='/'+this.config.get<string>('API_PREFIX','api/v1').replace(/^\/+|\/+$/g,'');
    const path=req.path.startsWith(prefix+'/')?req.path.slice(prefix.length):req.path;
    const feature=routeFeature(path);if(!feature)return true;
    // Data portability/personal historical payslips remain protected by existing RBAC + step-up.
    if(isHistoricalRead(req.method,path))return true;
    if(!req.user?.organisationId||!req.user.sub)throw new ForbiddenException('Organisation context required');
    const snapshot=await this.access.snapshot(req.user.organisationId,req.user.sub);
    if(!snapshot.features[feature]||(snapshot.readOnly&&!['GET','HEAD'].includes(req.method))) {
      throw new ForbiddenException({message:snapshot.readOnly?'Subscription access is read-only. Renew or contact the organisation Owner.':`Your subscription does not include ${feature}. Contact the organisation Owner.`,code:'SUBSCRIPTION_FEATURE_UNAVAILABLE',feature,state:snapshot.state});
    }
    return true;
  }
}
