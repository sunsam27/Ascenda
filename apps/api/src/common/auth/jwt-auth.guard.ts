// ─────────────────────────────────────────────────────────────────────────────
// JWT AUTH GUARD
// Global authentication guard. Everything is protected by default; only routes
// explicitly marked with `@Public()` are open. Registered before RbacGuard so
// that `req.user` is available when permissions are evaluated.
// ─────────────────────────────────────────────────────────────────────────────
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
