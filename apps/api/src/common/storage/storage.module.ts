import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global so any module can persist to object storage without re-importing. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
