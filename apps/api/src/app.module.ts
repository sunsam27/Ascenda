import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

// Common
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { AuditInterceptor } from './common/audit/audit.interceptor';

// Modules
import { IdentityAccessModule } from './modules/identity-access/identity-access.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { PeopleModule } from './modules/people/people.module';
import { TimeLeaveModule } from './modules/time-leave/time-leave.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TalentModule } from './modules/talent/talent.module';
import { ServiceModule } from './modules/service/service.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    // ── Config ────────────────────────────────────────────────────────────────
    ConfigModule.forRoot({ isGlobal: true, cache: true }),

    // ── Rate limiting (SECURITY.md §2) ────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 50 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),

    // ── Domain modules ────────────────────────────────────────────────────────
    IdentityAccessModule,
    OrganisationsModule,
    PeopleModule,
    TimeLeaveModule,
    PayrollModule,
    PaymentsModule,
    TalentModule,
    ServiceModule,
    DocumentsModule,
    AnalyticsModule,
    NotificationsModule,
    AuditModule,
    BillingModule,
  ],
  providers: [
    // Global rate limiting guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global audit interceptor — runs on every state-changing request
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tenant middleware runs on all routes — sets app.current_org in DB context
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
