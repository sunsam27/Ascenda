import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/context/context.middleware';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RbacGuard } from './common/rbac/rbac.guard';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PeopleModule } from './modules/people/people.module';
import { PlansModule } from './modules/plans/plans.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { ServiceModule } from './modules/service/service.module';
import { TalentModule } from './modules/talent/talent.module';
import { TimeLeaveModule } from './modules/time-leave/time-leave.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AnalyticsModule,
    AuditModule,
    BillingModule,
    DocumentsModule,
    IdentityAccessModule,
    NotificationsModule,
    OrganisationsModule,
    PaymentsModule,
    PayrollModule,
    PeopleModule,
    PlansModule,
    RegistrationsModule,
    ServiceModule,
    TalentModule,
    TimeLeaveModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
