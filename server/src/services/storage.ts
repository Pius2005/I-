import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env, s3Bucket } from '../env.js';

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
  private clientPromise: Promise<S3Client> | null = null;

  // Credentials come from static keys when they are configured (any S3
  // provider), otherwise from Vercel's OIDC federation, which is how the AWS
  // marketplace integration grants access without long-lived secrets.
  private client(): Promise<S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let credentials;
        if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
          credentials = {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          };
        } else if (env.AWS_ROLE_ARN) {
          const { awsCredentialsProvider } = await import('@vercel/functions/oidc');
          credentials = awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN });
        }
        return new S3Client({
          region: env.S3_REGION || env.AWS_REGION || 'us-east-1',
          endpoint: env.S3_ENDPOINT || undefined,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials,
        });
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string) {
    const client = await this.client();
    const res = await client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
  }
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 's3' && s3Bucket ? new S3Storage() : new LocalStorage();

export const localStream = (key: string) => new LocalStorage().stream(key);

export const cvStorageKey = (candidateId: string, filename: string) =>
  `cvs/${candidateId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
