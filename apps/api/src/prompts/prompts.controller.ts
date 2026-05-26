import { Controller, Get, Param, Query } from "@nestjs/common";
import { Prompt } from "@prisma/client";

import { ListPromptsQueryDto } from "./dto/list-prompts-query.dto";
import { PromptsService } from "./prompts.service";

@Controller("prompts")
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  list(@Query() query: ListPromptsQueryDto): Promise<Prompt[]> {
    return this.prompts.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<Prompt> {
    return this.prompts.findOne(id);
  }
}
