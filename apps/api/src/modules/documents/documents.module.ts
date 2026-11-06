import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentWorkflowsService } from './document-workflows.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentWorkflowsService],
  exports: [DocumentsService, DocumentWorkflowsService],
})
export class DocumentsModule {}
