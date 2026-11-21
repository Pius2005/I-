import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../env.js';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  private root = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);

  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new Error('Invalid storage key');
    return target;
  }

  async put(key: string, body: Buffer) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  stream(key: string) {
    return createReadStream(this.resolve(key));
  }
}

class S3Storage implements StorageDriver {
  private client = new S3Client({
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 's3' && env.S3_BUCKET ? new S3Storage() : new LocalStorage();

export const localStream = (key: string) => new LocalStorage().stream(key);

export const cvStorageKey = (candidateId: string, filename: string) =>
  `cvs/${candidateId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
