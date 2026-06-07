import { describe, it, expect, vi, beforeEach } from "vitest";

import { uploadImage } from "./upload-image";

vi.mock("./auth", () => ({
  apiBaseUrl: () => "http://api.test",
  getToken: vi.fn(() => "tok-123"),
}));

describe("uploadImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("发 multipart 到 /assets/upload 并返回服务器响应", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "a1",
          key: "users/u/2026/06/x.png",
          url: "https://mock.local/users/u/2026/06/x.png",
          mime: "image/png",
          size: 8,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "x.png", {
      type: "image/png",
    });
    const res = await uploadImage(file);
    expect(res.id).toBe("a1");
    expect(res.url).toContain("mock.local");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/assets/upload");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
    // 关键:不能预设 Content-Type,要让 fetch 自动算 boundary
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("非 2xx 抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("too big", { status: 400 }));
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadImage(file)).rejects.toThrow(/HTTP 400/);
  });
});
