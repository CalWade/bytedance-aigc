import { Injectable } from "@nestjs/common";

import type { PutResult, StorageService } from "./storage.service";

/**
 * CI / e2e 替身:不真发 PUT,直接返一个稳定 URL。
 * 业务路径(DTO 校验、limit、Asset 落库、controller 响应)仍走完整逻辑。
 */
@Injectable()
export class MockStorageService implements StorageService {
  put(key: string): Promise<PutResult> {
    return Promise.resolve({ url: `https://mock.local/${key}` });
  }
}
