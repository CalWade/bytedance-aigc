import { Injectable, Logger } from "@nestjs/common";
import type { ChatMessage } from "../llm/dto/chat-message.dto";
import { LlmClient } from "../llm/llm.client";

export interface AssetTags {
  sceneTags: string[];
  subjectTags: string[];
}

@Injectable()
export class AssetTaggingService {
  private readonly logger = new Logger(AssetTaggingService.name);
  constructor(private readonly llm: LlmClient) {}

  /**
   * 调 LLM 让它根据 hint(可选 description / aiPrompt / fileName)猜场景 + 主体标签。
   * Hint 缺失时返回保守默认 ["其他"]。
   * 失败 fallback ["其他"] + log warn,不阻塞入库。
   */
  async tag(hint: string): Promise<AssetTags> {
    if (!hint?.trim()) {
      return { sceneTags: ["其他"], subjectTags: ["其他"] };
    }
    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是图像标签助手。给定中文描述,输出 JSON: " +
            '{"scene":["..."],"subject":["..."]}。' +
            "scene 列出 1-3 个场景标签(如:办公室、街道、咖啡馆、家居、户外、夜景);" +
            "subject 列出 1-3 个主体标签(如:人物、动物、产品、食物、风景、车辆)。" +
            "标签用 2-4 字中文,不要解释,只输出 JSON。",
        },
        { role: "user", content: hint },
      ];
      const raw = await this.llm.chat(messages, { temperature: 0.0 });
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON");
      const parsed = JSON.parse(m[0]) as { scene?: string[]; subject?: string[] };
      return {
        sceneTags:
          Array.isArray(parsed.scene) && parsed.scene.length > 0
            ? parsed.scene.slice(0, 3)
            : ["其他"],
        subjectTags:
          Array.isArray(parsed.subject) && parsed.subject.length > 0
            ? parsed.subject.slice(0, 3)
            : ["其他"],
      };
    } catch (err) {
      this.logger.warn(`autoTag fallback: ${(err as Error).message}`);
      return { sceneTags: ["其他"], subjectTags: ["其他"] };
    }
  }
}
