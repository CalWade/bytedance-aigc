import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Review } from "@prisma/client";
import type { PreflightResponse } from "@bytedance-aigc/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import { UserGuard } from "../auth/user.guard";
import { ReviewService } from "./review.service";

@Controller("drafts")
@UseGuards(UserGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewService) {}

  @Post(":id/preflight")
  @HttpCode(HttpStatus.OK)
  preflight(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<PreflightResponse> {
    return this.reviews.preflight(id, user.sub);
  }

  @Get(":id/reviews")
  list(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Query("limit") limit?: string,
  ): Promise<Review[]> {
    const n = limit ? Number(limit) : 10;
    return this.reviews.listByDraft(id, user.sub, Number.isFinite(n) ? n : 10);
  }
}
