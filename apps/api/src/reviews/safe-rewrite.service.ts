import { Injectable } from "@nestjs/common";
import { EMPTY, Observable, concat, defer, from, merge, of } from "rxjs";
import { catchError, mergeMap } from "rxjs/operators";

import { LlmClient } from "../llm/llm.client";
import { PromptsService } from "../prompts/prompts.service";

/**
 * Phase 2.13 — 一键生成合规替代(SAFE_REWRITE)
 *
 * 单连接两路候选并发:同一 system prompt + user 命中信息,
 * 用两个不同 temperature(0.6 / 1.0)各跑一路,token 流以 idx 区分。
 *
 * 帧序列契约(spec §4.2):
 *   1. 首发 start×2(顺序无所谓,两路都要 start)
 *   2. 每路若干 {token, idx, delta}
 *   3. 每路终止时 {end, idx} 或 {error, idx, message}
 *   4. 两路都终止后 {done}
 *
 * 一路异常不影响另一路:LlmClient.chatStream 已把异常归一为帧 + complete,
 * 我们这里只在 map 里检查 frame.error → 转成 SafeRewrite error 帧。
 *
 * 本地 Frame 类型故意不 import shared 的 SafeRewriteFrame:
 * service 不应耦合 SSE 帧的精确结构,这是 controller 层职责。
 */
type Frame =
  | { event: "start"; idx: 0 | 1 }
  | { event: "token"; idx: 0 | 1; delta: string }
  | { event: "end"; idx: 0 | 1 }
  | { event: "done" }
  | { event: "error"; idx?: 0 | 1; message: string };

export interface SafeRewriteInput {
  draftId: string;
  text: string;
  hitCategories: string[];
  message: string;
}

const TEMPERATURES: readonly [number, number] = [0.6, 1.0];

@Injectable()
export class SafeRewriteService {
  constructor(
    private readonly llm: LlmClient,
    private readonly prompts: PromptsService,
  ) {}

  stream(input: SafeRewriteInput): Observable<Frame> {
    return defer(() =>
      from(this.prompts.findDefaultByTool("SAFE_REWRITE")).pipe(
        mergeMap((prompt) => {
          const userMsg =
            `命中类目: ${input.hitCategories.join(",")}\n` +
            `命中原因: ${input.message}\n` +
            `原文: ${input.text}`;
          const messages = [
            { role: "system" as const, content: prompt.systemPrompt },
            { role: "user" as const, content: userMsg },
          ];

          const body = (idx: 0 | 1): Observable<Frame> =>
            this.llm.chatStream(messages, { temperature: TEMPERATURES[idx] }).pipe(
              mergeMap<{ delta?: string; done?: true; error?: string }, Observable<Frame>>(
                (frame) => {
                  if (frame.error) {
                    return of<Frame>({ event: "error", idx, message: frame.error });
                  }
                  if (frame.done) {
                    return of<Frame>({ event: "end", idx });
                  }
                  if (frame.delta) {
                    return of<Frame>({ event: "token", idx, delta: frame.delta });
                  }
                  return EMPTY;
                },
              ),
            );

          // 先同步发两个 start,再 merge 两路 body,最后发 done
          const starts: Observable<Frame> = from<Frame[]>([
            { event: "start", idx: 0 },
            { event: "start", idx: 1 },
          ]);
          const bodies = merge(body(0), body(1));
          return concat(starts, bodies, of<Frame>({ event: "done" }));
        }),
        catchError((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          return concat(of<Frame>({ event: "error", message }), of<Frame>({ event: "done" }));
        }),
      ),
    );
  }
}
