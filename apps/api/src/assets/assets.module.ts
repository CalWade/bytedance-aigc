import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { getStorageConfig } from "../config/storage.config";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";
import { MockStorageService } from "./storage/mock-storage.service";
import { S3StorageService } from "./storage/s3-storage.service";
import { STORAGE_SERVICE, type StorageService } from "./storage/storage.service";

@Module({
  imports: [AuthModule],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (cs: ConfigService): StorageService => {
        const config = getStorageConfig(cs);
        if (config.driver === "mock") return new MockStorageService();
        return new S3StorageService(config);
      },
      inject: [ConfigService],
    },
  ],
})
export class AssetsModule {}
