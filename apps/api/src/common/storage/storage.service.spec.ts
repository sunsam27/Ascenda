import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StorageService } from './storage.service';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'https://private-storage.test/signed') }));
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('private document storage', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env.NODE_ENV = 'test'; delete process.env.STORAGE_DRIVER; send.mockReset(); });
  afterEach(() => { process.env = { ...original }; });
  it('preserves existing local keys in development and confines access', async () => {
    const root = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'documents-'));
    process.env.STORAGE_LOCAL_DIR = root;
    try {
      const storage = new StorageService();
      const { key } = await storage.put(Buffer.from('bytes'), 'org1');
      expect(key.startsWith('org1/')).toBe(true);
      expect((await storage.get(key)).toString()).toBe('bytes');
      expect(await storage.signedDownload(key, 'doc.pdf', 'application/pdf')).toBeUndefined();
      await storage.delete(key);
      await expect(storage.get(key)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('requires S3 storage in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new StorageService()).toThrow(/requires STORAGE_DRIVER=s3/);
  });
  it('uses encrypted S3 objects and five-minute signed attachment links', async () => {
    process.env.STORAGE_DRIVER = 's3'; process.env.STORAGE_BUCKET = 'private-documents';
    const storage = new StorageService();
    const { key } = await storage.put(Buffer.from('bytes'), 'org1');
    expect(key.startsWith('s3:org1/')).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      Bucket: 'private-documents', ServerSideEncryption: 'AES256',
    }) }));
    expect(await storage.signedDownload(key, 'Contract.pdf', 'application/pdf')).toBe('https://private-storage.test/signed');
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 300 });
    await storage.delete(key);
  });
});
