import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObject {
  key: string;
}

/**
 * Object storage for uploads (documents, later payslips/attachments).
 *
 * Development defaults to local disk. Production requires encrypted private
 * S3-compatible storage; downloads are signed attachments valid for 5 minutes.
 * Keys are driver-tagged so enabling S3 does not reinterpret existing local
 * keys. Legacy local files still need migration before a multi-node deployment.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = resolve(
    process.env['STORAGE_LOCAL_DIR'] ?? join(process.cwd(), '.storage'),
  );
  private readonly bucket = process.env.STORAGE_BUCKET;
  private readonly s3 = process.env.STORAGE_DRIVER === 's3' ? new S3Client({
    region: process.env.STORAGE_REGION ?? 'eu-west-1',
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    ...(process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY ? {
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY, secretAccessKey: process.env.STORAGE_SECRET_KEY },
    } : {}),
  }) : undefined;

  constructor() {
    if (process.env.NODE_ENV === 'production' && !this.s3) throw new Error('Production document storage requires STORAGE_DRIVER=s3');
    if (this.s3 && !this.bucket) throw new Error('STORAGE_BUCKET is required for S3 storage');
  }

  /** Persist `buffer` under a fresh opaque key, optionally namespaced. */
  async put(buffer: Buffer, prefix?: string): Promise<StoredObject> {
    const namespace = prefix?.replace(/[^a-zA-Z0-9/_-]/g, '') ?? '';
    const key = [namespace, randomUUID()].filter(Boolean).join('/');
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer,
        ServerSideEncryption: 'AES256', ContentType: 'application/octet-stream' }));
      return { key: `s3:${key}` };
    }
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    if (key.startsWith('s3:')) {
      if (!this.s3) throw new Error('S3 storage is not configured');
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key.slice(3) }));
      if (!response.Body) throw new Error('Stored object is empty');
      return Buffer.from(await response.Body.transformToByteArray());
    }
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    if (key.startsWith('s3:')) {
      if (!this.s3) throw new Error('S3 storage is not configured');
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key.slice(3) }));
      return;
    }
    await rm(this.pathFor(key), { force: true });
  }

  async signedDownload(key: string, name: string, mimeType: string): Promise<string | undefined> {
    if (!key.startsWith('s3:')) return undefined; // Authenticated streaming for existing local development files.
    if (!this.s3) throw new Error('S3 storage is not configured');
    return getSignedUrl(this.s3, new GetObjectCommand({
      Bucket: this.bucket, Key: key.slice(3), ResponseContentType: mimeType,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 300 });
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
