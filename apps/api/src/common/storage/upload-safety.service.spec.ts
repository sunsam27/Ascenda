import { createServer } from 'node:net';
import sharp from 'sharp';
import { UploadSafetyService } from './upload-safety.service';

describe('document upload safety', () => {
  const original = { ...process.env };
  beforeEach(() => { delete process.env.DOCUMENT_SCAN_HOST; delete process.env.DOCUMENT_SCAN_REQUIRED; process.env.NODE_ENV = 'test'; });
  afterEach(() => { process.env = { ...original }; });
  const safety = new UploadSafetyService();
  const pdf = Buffer.from('%PDF-1.7\nTest content\n%%EOF');

  it('recognises PDF content independently of the supplied MIME', async () => {
    expect((await safety.prepare(pdf, 'application/pdf', 'Contract.pdf')).mimeType).toBe('application/pdf');
    await expect(safety.prepare(pdf, 'image/png', 'photo.png')).rejects.toThrow(/does not match/);
  });
  it('rejects unsupported executable and corrupt image content', async () => {
    await expect(safety.prepare(Buffer.from('MZ executable'), 'application/octet-stream', 'program.exe')).rejects.toThrow(/Unsupported/);
    await expect(safety.prepare(Buffer.from([255, 216, 255, 0]), 'image/jpeg', 'photo.jpg')).rejects.toThrow(/processed safely/);
  });
  it('removes EXIF metadata while keeping a readable image', async () => {
    const source = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg()
      .withMetadata({ exif: { IFD0: { Artist: 'private-person' } } }).toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await safety.prepare(source, 'image/jpeg', 'ID.jpg');
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
  });
  it('accepts UTF-8 text, rejects binary or HTML uploads', async () => {
    expect((await safety.prepare(Buffer.from('Policy notes'), 'text/plain', 'notes.txt')).mimeType).toBe('text/plain');
    await expect(safety.prepare(Buffer.from('<script>alert(1)</script>'), 'text/plain', 'notes.txt')).rejects.toThrow(/Unsupported/);
    await expect(safety.prepare(Buffer.from([0, 1, 255]), 'text/plain', 'notes.txt')).rejects.toThrow(/Unsupported/);
  });
  it('does not bypass malware scanning in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(safety.prepare(pdf, 'application/pdf', 'doc.pdf')).rejects.toThrow(/scanning is not configured/);
  });
  it.each(['stream: OK\0', 'stream: Eicar-Test-Signature FOUND\0', 'stream: scanner error\0'])(
    'uses the configured ClamAV protocol and handles %j', async (response) => {
      const server = createServer((socket) => {
        let bytes = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          bytes = Buffer.concat([bytes, chunk]);
          if (bytes.length >= 10 + 4 + pdf.length + 4) socket.end(response);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      process.env.DOCUMENT_SCAN_HOST = '127.0.0.1';
      process.env.DOCUMENT_SCAN_PORT = String((server.address() as { port: number }).port);
      try {
        const result = safety.prepare(pdf, 'application/pdf', 'doc.pdf');
        if (response.includes('OK')) await expect(result).resolves.toMatchObject({ mimeType: 'application/pdf' });
        else await expect(result).rejects.toThrow(response.includes('FOUND') ? /rejected by the malware scanner/ : /could not verify/);
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    });
});
