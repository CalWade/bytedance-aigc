import { ConfigService } from "@nestjs/config";
import { firstValueFrom, lastValueFrom, toArray } from "rxjs";

const createMock = jest.fn();
const constructorSpy = jest.fn();

/**
 * mock openai SDK:default 导出为可被 spy 的构造函数,client.chat.completions.create
 * 共享同一个 jest.fn,可在每个用例里 mockResolvedValue / mockReturnValue 切行为。
 */
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: { baseURL?: string; apiKey?: string }) => {
    constructorSpy(opts);
    return {
      chat: { completions: { create: createMock } },
    };
  }),
}));

import { LlmClient } from "./llm.client";

const FAKE_BASE_URL = "https://fake.example.com/v1";
const FAKE_API_KEY = "sk-test-key";
const FAKE_MODEL = "fake-model-2026";

function makeConfigService(): ConfigService {
  const map: Record<string, string> = {
    LLM_BASE_URL: FAKE_BASE_URL,
    LLM_API_KEY: FAKE_API_KEY,
    LLM_MODEL: FAKE_MODEL,
  };
  // 只实现 getOrThrow,LlmClient 只调它一种
  return {
    getOrThrow: (key: string) => {
      const v = map[key];
      if (v === undefined) throw new Error(`Missing ${key}`);
      return v;
    },
  } as unknown as ConfigService;
}

/** 把数组包成 OpenAI SDK 的 ChatCompletionStream(只用到 [Symbol.asyncIterator]) */
function makeStream(chunks: unknown[]) {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

describe("LlmClient", () => {
  beforeEach(() => {
    createMock.mockReset();
    constructorSpy.mockReset();
  });

  it("chat 一次性返回完整 string", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "hello world" } }],
    });

    const client = new LlmClient(makeConfigService());
    const out = await client.chat([{ role: "user", content: "hi" }], { temperature: 0.3 });

    expect(out).toBe("hello world");
    expect(createMock).toHaveBeenCalledWith({
      model: FAKE_MODEL,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.3,
      stream: false,
    });
  });

  it("chatStream emit 增量 token + done 帧", async () => {
    createMock.mockResolvedValueOnce(
      makeStream([
        { choices: [{ delta: { content: "你好" }, finish_reason: null }] },
        { choices: [{ delta: { content: ",世界" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    );

    const client = new LlmClient(makeConfigService());
    const frames = await lastValueFrom(
      client.chatStream([{ role: "user", content: "stream please" }]).pipe(toArray()),
    );

    expect(frames).toEqual([{ delta: "你好" }, { delta: ",世界" }, { done: true }]);
  });

  it("chat 抛错往上抛(让默认 ExceptionFilter 转 502,Plan D6)", async () => {
    createMock.mockRejectedValueOnce(new Error("rate limited"));

    const client = new LlmClient(makeConfigService());
    await expect(client.chat([{ role: "user", content: "x" }])).rejects.toThrow("rate limited");
  });

  it("chatStream 异常归一为 { error } 帧而非 throw(SSE 链路保持帧序)", async () => {
    createMock.mockRejectedValueOnce(new Error("upstream timeout"));

    const client = new LlmClient(makeConfigService());
    const first = await firstValueFrom(client.chatStream([{ role: "user", content: "x" }]));
    expect(first).toEqual({ error: "upstream timeout" });
  });

  it("baseURL / apiKey 透传给 OpenAI 构造函数", () => {
    new LlmClient(makeConfigService());
    expect(constructorSpy).toHaveBeenCalledWith({
      baseURL: FAKE_BASE_URL,
      apiKey: FAKE_API_KEY,
    });
  });
});
