import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { Observable } from "rxjs";
import { getLlmConfig } from "../config/llm.config";
import type { ChatMessage } from "./dto/chat-message.dto";

/**
 * 流式输出的归一帧(spec §4.2 + Plan Task 3 N5):
 * - `delta`:增量 token(中间帧)
 * - `done: true`:正常结束(任意厂商的 finish_reason 都映射到这里)
 * - `error`:SDK 抛错被归一为帧而非 throw,让 Observable 消费方按帧处理
 */
export interface ChatStreamFrame {
  delta?: string;
  done?: true;
  error?: string;
}

/**
 * LLM 薄 adapter:封装 OpenAI SDK + 自定义 baseURL,对外暴露 chat()/chatStream()。
 *
 * 设计原则:
 * - 厂商无感:`LLM_BASE_URL` 决定打哪家(OpenAI / 火山 ARK / DeepSeek / 自建网关),
 *   service 层永远只依赖 `ChatMessage` + `ChatStreamFrame` 两个契约。
 * - finish_reason 归一:OpenAI `"stop"` / 部分厂商 `null` / 其他都收敛到 `{ done: true }`。
 * - 错误归一:同步 chat() 抛 Error 让 NestJS 默认 ExceptionFilter 转 502(Plan D6);
 *   流式 chatStream() 把 SDK 异常转成 `{ error }` 帧而不 throw,避免半截流断在 SSE 中段。
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(cs: ConfigService) {
    const { baseURL, apiKey, model } = getLlmConfig(cs);
    this.client = new OpenAI({ baseURL, apiKey });
    this.model = model;
  }

  /**
   * 一次性 chat。同步路径,LLM 抛错往上抛,由 NestJS 默认 Filter → 502。
   */
  async chat(messages: ChatMessage[], opts?: { temperature?: number }): Promise<string> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: opts?.temperature,
      stream: false,
    });
    return resp.choices[0]?.message?.content ?? "";
  }

  /**
   * 流式 chat。返 rxjs Observable,每 chunk 一帧,结束发 `{ done: true }`,
   * 异常发 `{ error }` 然后 complete(不 emit error,让 SSE 链路保持帧序)。
   */
  chatStream(
    messages: ChatMessage[],
    opts?: { temperature?: number },
  ): Observable<ChatStreamFrame> {
    return new Observable<ChatStreamFrame>((subscriber) => {
      let cancelled = false;

      void (async () => {
        try {
          const stream = await this.client.chat.completions.create({
            model: this.model,
            messages,
            temperature: opts?.temperature,
            stream: true,
          });
          for await (const chunk of stream) {
            if (cancelled) break;
            const choice = chunk.choices[0];
            const delta = choice?.delta?.content;
            if (delta) {
              subscriber.next({ delta });
            }
            if (choice?.finish_reason) {
              subscriber.next({ done: true });
              break;
            }
          }
          if (!cancelled) {
            subscriber.complete();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`chatStream error: ${message}`);
          if (!cancelled) {
            subscriber.next({ error: message });
            subscriber.complete();
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    });
  }
}
