import { Injectable, Logger } from "@nestjs/common";
import { Observable } from "rxjs";

import type { ChatMessage } from "../llm/dto/chat-message.dto";
import { LlmClient } from "../llm/llm.client";
import { DraftsService } from "./drafts.service";
import type { SectionsStreamDto } from "./dto/sections-stream.dto";

/** SSE 帧统一形态。NestJS @Sse 把 Observable<MessageEvent> 包装为 SSE 协议帧。 */
export interface SseFramePayload {
  type: "section.start" | "token" | "section.end" | "done" | "error";
  data: Record<string, unknown>;
}
export type StreamMessageEvent = { data: SseFramePayload };

const SECTION_SYSTEM_PROMPT = [
  "你是一名中长图文资讯编辑助手。",
  "用户会给你一个章节标题与提示,你按照中文资讯文体写正文,不要 markdown 代码块,",
  "不要冗长开场白,3-8 句话以内即可。",
].join("\n");

/**
 * Phase 2.2 FAST 模式分节流式生成。
 *
 * 错误处理(Plan Task 6 + spec §4.6):
 * - assertAuthor 不通过(404/403)→ throw,让 NestJS 在响应头 SSE 切换前回 JSON 错误。
 * - 进入流之后任何异常 → emit `{ type:"error" }` 帧并 complete(),不让 PrismaKnownRequestFilter
 *   等全局 Filter 截胡(响应头已是 text/event-stream,没法再回 JSON 错误体)。
 */
@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(
    private readonly drafts: DraftsService,
    private readonly llm: LlmClient,
  ) {}

  async stream(
    draftId: string,
    userSub: string,
    dto: SectionsStreamDto,
  ): Promise<Observable<StreamMessageEvent>> {
    // 鉴权在切 SSE 响应头之前,失败直接 throw → 走全局 Filter 转 JSON
    await this.drafts.assertAuthor(draftId, userSub);

    return new Observable<StreamMessageEvent>((subscriber) => {
      let cancelled = false;
      const startIdx = dto.cursor ?? 0;

      const emit = (frame: SseFramePayload) => {
        if (!cancelled) subscriber.next({ data: frame });
      };

      (async () => {
        try {
          for (let i = startIdx; i < dto.sections.length; i++) {
            if (cancelled) return;
            const section = dto.sections[i];
            emit({ type: "section.start", data: { index: i, heading: section.heading } });

            const messages: ChatMessage[] = [
              { role: "system", content: SECTION_SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  `章节标题:${section.heading}`,
                  `本节摘要:${section.summary}`,
                  section.hint ? `提示:${section.hint}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ];

            await new Promise<void>((resolve, reject) => {
              const sub = this.llm.chatStream(messages, { temperature: 0.7 }).subscribe({
                next: (frame) => {
                  if (cancelled) {
                    sub.unsubscribe();
                    resolve();
                    return;
                  }
                  if (frame.error) {
                    reject(new Error(frame.error));
                    return;
                  }
                  if (frame.delta) {
                    emit({ type: "token", data: { index: i, delta: frame.delta } });
                  }
                  if (frame.done) {
                    emit({ type: "section.end", data: { index: i } });
                    resolve();
                  }
                },
                error: (err) => reject(err),
                complete: () => resolve(),
              });
            });
          }

          emit({ type: "done", data: {} });
          if (!cancelled) subscriber.complete();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`stream error: ${message}`);
          emit({ type: "error", data: { message } });
          if (!cancelled) subscriber.complete();
        }
      })();

      return () => {
        cancelled = true;
      };
    });
  }
}
