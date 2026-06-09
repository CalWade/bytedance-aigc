import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { DraftToolType } from "@prisma/client";

import { UserGuard } from "../../auth/user.guard";
import { AdminGuard } from "../../reports/admin.guard";
import { PromptLabService } from "./prompt-lab.service";

@Controller("admin/prompt-lab")
@UseGuards(UserGuard, AdminGuard)
export class PromptLabController {
  constructor(private readonly service: PromptLabService) {}

  @Post("test-cases")
  @HttpCode(HttpStatus.CREATED)
  addTestCase(
    @Body() body: { tool: DraftToolType; input: string; expected: string; category?: string },
  ) {
    return this.service.addTestCase(body.tool, body.input, body.expected, body.category);
  }

  @Get("test-cases")
  listTestCases(
    @Query("tool") tool?: DraftToolType,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.service.listTestCases(
      tool,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Post("eval-runs")
  @HttpCode(HttpStatus.OK)
  runEval(@Body() body: { tool: DraftToolType; candidatePromptId: string }) {
    return this.service.runEval(body.tool, body.candidatePromptId);
  }

  @Get("eval-runs")
  listEvalRuns(@Query("tool") tool?: DraftToolType, @Query("limit") limit?: string) {
    return this.service.listEvalRuns(tool, limit ? parseInt(limit, 10) : 20);
  }

  @Get("eval-runs/:id/compare")
  compareWithCurrent(@Param("id") id: string) {
    return this.service.compareWithCurrent(id);
  }

  @Post("eval-runs/:id/promote")
  @HttpCode(HttpStatus.OK)
  promoteToLive(@Param("id") id: string, @Body() body: { note?: string }) {
    return this.service.promoteToLive(id, "admin", body.note);
  }

  @Post("rollback")
  @HttpCode(HttpStatus.OK)
  rollback(@Body() body: { tool: DraftToolType; note?: string }) {
    return this.service.rollback(body.tool, "admin", body.note);
  }
}
