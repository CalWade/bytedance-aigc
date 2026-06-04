import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DraftsModule } from "../drafts/drafts.module";
import { PromptsModule } from "../prompts/prompts.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewService } from "./review.service";

@Module({
  imports: [AuthModule, DraftsModule, PromptsModule],
  controllers: [ReviewsController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewsModule {}
