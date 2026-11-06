import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { connect } from 'node:net';
import { extname } from 'node:path';
import { TextDecoder } from 'node:util';
import sharp from 'sharp';

/** Scan original bytes before parsing; fail closed if a configured scanner fails. */
@Injectable()
export class UploadSafetyService {
  async prepare(bytes: Buffer, declaredMime: string, name: string): Promise<{ buffer: Buffer; mimeType: string }> {
    await this.scan(bytes);
    let mimeType: string;
    let buffer = bytes;
    if (bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) {
      mimeType = 'application/pdf';
    } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      mimeType = 'image/png';
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      mimeType = 'image/jpeg';
    } else {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /^\s*(?:<|#!|MZ)/.test(text)) throw new Error();
        mimeType = 'text/plain';
      } catch {
        throw new BadRequestException('Unsupported file content. Upload a PDF, PNG, JPEG or UTF-8 text file.');
      }
    }
    const extensions: Record<string, string[]> = {
      'application/pdf': ['.pdf'], 'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'], 'text/plain': ['.txt'],
    };
    const extension = extname(name).toLowerCase();
    if ((declaredMime !== mimeType && declaredMime !== 'application/octet-stream') ||
        (extension && !extensions[mimeType]?.includes(extension))) {
      throw new BadRequestException('The file content does not match its type or filename.');
    }
    if (mimeType.startsWith('image/')) {
      try {
        // Re-encoding strips EXIF/GPS/XMP and rejects malformed/decompression-bomb images.
        const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).rotate();
        buffer = await (mimeType === 'image/png' ? image.png() : image.jpeg()).toBuffer();
      } catch {
        throw new BadRequestException('The image could not be processed safely.');
      }
    }
    return { buffer, mimeType };
  }

  private async scan(bytes: Buffer): Promise<void> {
    const host = process.env.DOCUMENT_SCAN_HOST;
    if (!host) {
      if (process.env.NODE_ENV === 'production' || process.env.DOCUMENT_SCAN_REQUIRED === 'true') {
        throw new ServiceUnavailableException('Document malware scanning is not configured. Contact your administrator.');
      }
      return; // Development only; never a production bypass.
    }
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host, port: Number(process.env.DOCUMENT_SCAN_PORT ?? 3310) });
      let response = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        error ? reject(error) : resolve();
      };
      socket.setTimeout(30_000, () => finish(new ServiceUnavailableException('Document scanning timed out. Please try again.')));
      socket.on('error', () => finish(new ServiceUnavailableException('Document scanning is unavailable. Please try again.')));
      socket.on('data', (data: Buffer) => {
        response += data.toString();
        if (response.length > 4096) return finish(new ServiceUnavailableException('Invalid scanner response.'));
        if (!response.includes('\0') && !response.includes('\n')) return;
        if (/ FOUND[\0\n]/.test(response)) finish(new BadRequestException('This file was rejected by the malware scanner.'));
        else if (/^stream: OK[\0\n]/.test(response)) finish();
        else finish(new ServiceUnavailableException('The malware scanner could not verify this file.'));
      });
      socket.on('close', () => { if (!settled) finish(new ServiceUnavailableException('Document scanning did not complete.')); });
      socket.on('connect', async () => {
        try {
          socket.write('zINSTREAM\0');
          for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
            const chunk = bytes.subarray(offset, offset + 64 * 1024);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(chunk.length);
            socket.write(size);
            if (!socket.write(chunk)) await new Promise<void>((done, fail) => {
              const drain = () => { socket.off('close', closed); done(); };
              const closed = () => { socket.off('drain', drain); fail(new Error('Scanner disconnected')); };
              socket.once('drain', drain); socket.once('close', closed);
            });
          }
          socket.write(Buffer.alloc(4));
        } catch { finish(new ServiceUnavailableException('Document scanning is unavailable. Please try again.')); }
      });
    });
  }
}
