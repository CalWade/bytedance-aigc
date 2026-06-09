import { Module } from "@nestjs/common";

import { AdminContentController } from "./admin-content.controller";
import { AdminContentService } from "./admin-content.service";
import { SampleAuditController } from "./sample-audit/sample-audit.controller";
import { SampleAuditService } from "./sample-audit/sample-audit.service";
import { RuleRecheckController } from "./rule-recheck/rule-recheck.controller";
import { RuleRecheckService } from "./rule-recheck/rule-recheck.service";
import { PromptLabController } from "./prompt-lab/prompt-lab.controller";
import { PromptLabService } from "./prompt-lab/prompt-lab.service";
import { ReviewsModule } from "../reviews/reviews.module";
import { PromptsModule } from "../prompts/prompts.module";

@Module({
  imports: [ReviewsModule, PromptsModule],
  controllers: [
    AdminContentController,
    SampleAuditController,
    RuleRecheckController,
    PromptLabController,
  ],
  providers: [AdminContentService, SampleAuditService, RuleRecheckService, PromptLabService],
  exports: [AdminContentService],
})
export class AdminModule {}
