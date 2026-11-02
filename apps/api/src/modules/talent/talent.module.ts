import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TalentController } from './talent.controller';
import { TalentService } from './talent.service';

@Module({
  imports: [AuditModule],
  controllers: [TalentController],
  providers: [TalentService],
  exports: [TalentService],
})
export class TalentModule {}
