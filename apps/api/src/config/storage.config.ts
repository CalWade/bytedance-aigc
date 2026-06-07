import type { ConfigService } from "@nestjs/config";

export type StorageDriver = "s3" | "mock";

export interface StorageConfig {
  driver: StorageDriver;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
}

/**
 * STORAGE_DRIVER=mock 时只校验 driver,其余 S3_* 不读(CI / e2e 用)。
 * STORAGE_DRIVER=s3 时全部 getOrThrow,缺失启动期拒。
 */
export function getStorageConfig(cs: ConfigService): StorageConfig {
  const raw = cs.get<string>("STORAGE_DRIVER") ?? "s3";
  if (raw !== "s3" && raw !== "mock") {
    throw new Error(`Invalid STORAGE_DRIVER: ${raw}`);
  }
  const driver: StorageDriver = raw;
  if (driver === "mock") {
    return {
      driver,
      endpoint: "",
      region: "",
      bucket: "",
      accessKey: "",
      secretKey: "",
      publicUrl: "",
      forcePathStyle: false,
    };
  }
  return {
    driver,
    endpoint: cs.getOrThrow<string>("S3_ENDPOINT"),
    region: cs.getOrThrow<string>("S3_REGION"),
    bucket: cs.getOrThrow<string>("S3_BUCKET"),
    accessKey: cs.getOrThrow<string>("S3_ACCESS_KEY"),
    secretKey: cs.getOrThrow<string>("S3_SECRET_KEY"),
    publicUrl: cs.getOrThrow<string>("S3_PUBLIC_URL"),
    forcePathStyle: cs.get<string>("S3_FORCE_PATH_STYLE") !== "false",
  };
}
