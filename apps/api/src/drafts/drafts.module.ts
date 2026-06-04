import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PromptsModule } from "../prompts/prompts.module";
import { DraftsController } from "./drafts.controller";
import { DraftsService } from "./drafts.service";
import { OutlineService } from "./outline.service";
import { SectionsService } from "./sections.service";
import { ToolsService } from "./tools.service";

@Module({
  imports: [AuthModule, PromptsModule],
  controllers: [DraftsController],
  providers: [DraftsService, OutlineService, SectionsService, ToolsService],
  exports: [DraftsService],
})
export class DraftsModule {}
