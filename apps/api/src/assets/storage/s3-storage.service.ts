import { Injectable } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { StorageConfig } from "../../config/storage.config";
import type { PutResult, StorageService } from "./storage.service";

@Injectable()
export class S3StorageService implements StorageService {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  async put(key: string, body: Buffer, mime: string): Promise<PutResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
    return { url: `${this.config.publicUrl}/${key}` };
  }
}
