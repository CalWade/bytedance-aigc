import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaKnownRequestFilter } from "./common/filters/prisma-known-request.filter";
import { DraftsModule } from "./drafts/drafts.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PromptsModule } from "./prompts/prompts.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, DraftsModule, PromptsModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: PrismaKnownRequestFilter }],
})
export class AppModule {}
