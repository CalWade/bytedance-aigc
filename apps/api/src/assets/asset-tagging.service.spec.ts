import { AssetTaggingService } from "./asset-tagging.service";
import { LlmClient } from "../llm/llm.client";

function makeLlm(chatReturn?: string | Error) {
  const chat = jest.fn();
  if (chatReturn !== undefined) {
    if (chatReturn instanceof Error) {
      chat.mockRejectedValueOnce(chatReturn);
    } else {
      chat.mockResolvedValueOnce(chatReturn);
    }
  }
  return { chat } as unknown as LlmClient;
}

describe("AssetTaggingService", () => {
  it("无 hint 返默认'其他'", async () => {
    const chat = jest.fn();
    const llm = { chat } as unknown as LlmClient;
    const svc = new AssetTaggingService(llm);
    const result = await svc.tag("");
    expect(result).toEqual({ sceneTags: ["其他"], subjectTags: ["其他"] });
    expect(chat).not.toHaveBeenCalled();
  });

  it("正常 LLM JSON 解析", async () => {
    const llm = makeLlm('{"scene":["办公室","街道"],"subject":["人物","产品"]}');
    const svc = new AssetTaggingService(llm);
    const result = await svc.tag("办公室里的员工");
    expect(result).toEqual({ sceneTags: ["办公室", "街道"], subjectTags: ["人物", "产品"] });
  });

  it("LLM 返回非 JSON → fallback '其他'", async () => {
    const llm = makeLlm("this is not json");
    const svc = new AssetTaggingService(llm);
    const result = await svc.tag("something");
    expect(result).toEqual({ sceneTags: ["其他"], subjectTags: ["其他"] });
  });

  it("scene 缺失 → fallback '其他' for sceneTags", async () => {
    const llm = makeLlm('{"subject":["人物"]}');
    const svc = new AssetTaggingService(llm);
    const result = await svc.tag("人物照片");
    expect(result.sceneTags).toEqual(["其他"]);
    expect(result.subjectTags).toEqual(["人物"]);
  });

  it("subject 缺失 → fallback '其他' for subjectTags", async () => {
    const llm = makeLlm('{"scene":["办公室"]}');
    const svc = new AssetTaggingService(llm);
    const result = await svc.tag("办公室照片");
    expect(result.sceneTags).toEqual(["办公室"]);
    expect(result.subjectTags).toEqual(["其他"]);
  });
});
