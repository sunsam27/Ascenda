import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredObject {
  key: string;
}

/**
 * Object storage for uploads (documents, later payslips/attachments).
 *
 * The active driver writes to the local filesystem (`STORAGE_LOCAL_DIR`,
 * default `<cwd>/.storage`), which is sufficient for development and
 * self-hosted installs. Moving to S3-compatible storage later means
 * implementing `put`/`get`/`delete` against `@aws-sdk/client-s3` behind this
 * same interface — callers only ever hold an opaque key, never a path.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = resolve(
    process.env['STORAGE_LOCAL_DIR'] ?? join(process.cwd(), '.storage'),
  );

  /** Persist `buffer` under a fresh opaque key, optionally namespaced. */
  async put(buffer: Buffer, prefix?: string): Promise<StoredObject> {
    const namespace = prefix?.replace(/[^a-zA-Z0-9/_-]/g, '') ?? '';
    const key = [namespace, randomUUID()].filter(Boolean).join('/');
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Resolve a key to an absolute path, confined to `root` (no traversal). */
  private pathFor(key: string): string {
    const sanitized = key.replace(/[^a-zA-Z0-9/_-]/g, '');
    const full = resolve(join(this.root, sanitized));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      this.logger.error(`Rejected storage key outside root: ${key}`);
      throw new Error('Invalid storage key');
    }
    return full;
  }
}
