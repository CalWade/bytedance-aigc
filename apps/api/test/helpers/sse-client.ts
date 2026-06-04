import { request as httpRequest, IncomingMessage } from "node:http";

export interface SseFrame {
  event?: string;
  data: unknown;
}

/**
 * Plan D4 — node:http 真起 client 读 SSE 响应,supertest 不支持流式。
 * 假定 server 协议帧形如 `data: <json>\n\n`(NestJS @Sse 默认输出);
 * NestJS 11 的 @Sse 会自动把 Observable<MessageEvent> 序列化,所以
 * server 端发的 `MessageEvent.data` 这里 JSON.parse 即可。
 */
export async function readSse(opts: {
  host: string;
  port: number;
  path: string;
  method: "POST";
  body: unknown;
  token: string;
  timeoutMs?: number;
}): Promise<{ status: number; frames: SseFrame[] }> {
  const payload = JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: opts.host,
        port: opts.port,
        path: opts.path,
        method: opts.method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Accept: "text/event-stream",
          Authorization: `Bearer ${opts.token}`,
        },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        let buffer = "";
        const frames: SseFrame[] = [];

        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let sep: number;
          // SSE 帧以 \n\n 结束
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const frame: SseFrame = { data: undefined };
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) frame.event = line.slice(6).trim();
              else if (line.startsWith("data:")) {
                const txt = line.slice(5).trim();
                try {
                  frame.data = JSON.parse(txt);
                } catch {
                  frame.data = txt;
                }
              }
            }
            if (frame.event !== undefined || frame.data !== undefined) {
              frames.push(frame);
            }
          }
        });
        res.on("end", () => resolve({ status, frames }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error("readSse timeout"));
      });
    }
    req.write(payload);
    req.end();
  });
}
