import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadSafetyService } from './upload-safety.service';

/** Global so any module can persist to object storage without re-importing. */
@Global()
@Module({
  providers: [StorageService, UploadSafetyService],
  exports: [StorageService, UploadSafetyService],
})
export class StorageModule {}
