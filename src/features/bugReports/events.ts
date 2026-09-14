import https from "node:https";
import { BridgeConfig } from "./config";

export class EventDecoder {
  private line = "";
  private event = "";
  constructor(private readonly notify: () => void) {}
  feed(chunk: string): void {
    for (const c of chunk) {
      if (c !== "\n") {
        this.line += c;
        if (this.line.length > 4096) throw new Error("Oversized bridge event line");
        continue;
      }
      const line = this.line.replace(/\r$/, "");
      this.line = "";
      if (!line) {
        if (this.event === "ready" || this.event === "report-filed") this.notify();
        this.event = "";
      } else if (line.startsWith("event:")) this.event = line.slice(6).trim();
    }
  }
}

export function subscribeReports(config: BridgeConfig, notify: () => void): () => void {
  let stopped = false;
  let request: ReturnType<typeof https.get> | undefined;
  let retry: NodeJS.Timeout | undefined;
  let delay = 1000;
  let warned = false;
  const connect = () => {
    if (stopped) return;
    let ended = false;
    const disconnected = () => {
      if (ended || stopped) return;
      ended = true;
      request?.destroy();
      if (!warned) console.warn("RCSupport event stream disconnected/unavailable; polling remains active. Reconnecting.");
      warned = true;
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };
    request = https.get(new URL("/api/v1/events", config.baseUrl), {
      agent: config.agent, headers: { Authorization: `Bearer ${config.token}`, Accept: "text/event-stream" },
      timeout: 10000,
    }, response => {
      if (response.statusCode !== 200 || !response.headers["content-type"]?.startsWith("text/event-stream")) {
        response.destroy(); disconnected(); return;
      }
      delay = 1000;
      warned = false;
      request!.setTimeout(45000);
      console.log("RCSupport live report notifications connected; polling remains active as recovery.");
      const decoder = new EventDecoder(notify);
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        try { decoder.feed(chunk); } catch { response.destroy(); disconnected(); }
      });
      response.on("error", disconnected);
      response.on("close", disconnected);
    });
    request.on("error", disconnected);
    request.on("timeout", disconnected);
  };
  connect();
  return () => { stopped = true; if (retry) clearTimeout(retry); request?.destroy(); };
}
