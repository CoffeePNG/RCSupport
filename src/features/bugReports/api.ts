import https from "node:https";
import { BridgeConfig } from "./config";
import { AlertMode, PluginTicket, TicketStatus, StatusUpdate, OutboundReply } from "./types";

interface Envelope<T> { data: T | null; error: { code: string; message: string } | null }

export class BridgeClient {
  constructor(private readonly config: BridgeConfig) {}

  private request<T>(method: string, path: string, body?: object): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method, agent: this.config.agent,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 10000,
      }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; if (raw.length > 1_000_000) response.destroy(new Error("Bridge response too large")); });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const envelope = JSON.parse(raw) as Envelope<T>;
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300 || envelope.error)
              throw new Error(`Bridge ${method} ${path}: ${response.statusCode} ${envelope.error?.message ?? raw}`);
            if (envelope.data === null) throw new Error("Bridge returned no data");
            resolve(envelope.data);
          } catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Bridge request timed out")));
      if (payload) req.write(payload);
      req.end();
    });
  }

  reserveReportNumber(requestId: string): Promise<{ id: number }> {
    return this.request("POST", "/api/v1/report-numbers", { request_id: requestId });
  }
  pendingDeletions(after = 0): Promise<PluginTicket[]> { return this.request("GET", `/api/v1/deletions?after=${after}`); }
  confirmThreadDeleted(id: number, post: string): Promise<unknown> {
    return this.request("POST", `/api/v1/tickets/${id}/thread-deleted`, {post_id:post});
  }
  markThreadUnavailable(id: number, post: string): Promise<unknown> {
    return this.request("POST", `/api/v1/tickets/${id}/thread-unavailable`, {post_id:post});
  }
  outboundReplies(after = 0): Promise<OutboundReply[]> { return this.request("GET", `/api/v1/replies?after=${after}`); }
  acknowledgeReply(reply: OutboundReply, result: { message_id: string } | { failure: string }): Promise<unknown> {
    return this.request("POST", `/api/v1/replies/${reply.id}/ack`, { post_id: reply.post_id, ...result });
  }
  configMode(): Promise<{ alert_mode: AlertMode }> { return this.request("GET", "/api/v1/config"); }
  tickets(since: number): Promise<PluginTicket[]> {
    return this.request("GET", `/api/v1/tickets?status=open&since=${since}`);
  }
  statusUpdates(after = 0): Promise<StatusUpdate[]> { return this.request("GET", `/api/v1/status-updates?after=${after}`); }
  acknowledgeStatus(id: number, revision: number): Promise<{ acknowledged: boolean }> {
    return this.request("POST", `/api/v1/tickets/${id}/status-sync`, { revision });
  }
  ticket(id: number): Promise<{ ticket: PluginTicket; messages: unknown[]; revision: number }> {
    return this.request("GET", `/api/v1/tickets/${id}?include_messages=false`);
  }
  setPost(id: number, postId: string): Promise<PluginTicket> {
    return this.request("POST", `/api/v1/tickets/${id}/post`, { post_id: postId });
  }
  status(id: number, status: TicketStatus, actor?: string, expectedRevision?: number): Promise<PluginTicket> {
    return this.request("PATCH", `/api/v1/tickets/${id}/status`, { status, ...(actor ? { actor } : {}), ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }) });
  }
  importHistory(id: number, message: { post_id: string; message_id: string; author: string; body: string; created_at: number; notify: boolean; notify_subscribers?: boolean }): Promise<{inserted: boolean}> {
    return this.request("POST", `/api/v1/tickets/${id}/history`, message);
  }
  reply(id: number, author: string, body: string): Promise<unknown> {
    return this.request("POST", `/api/v1/tickets/${id}/reply`, { author, body });
  }
}

export class AlertModeCache {
  private last: AlertMode | null = null;
  private expiresAt = 0;
  constructor(private readonly fetchMode: () => Promise<AlertMode>, private readonly ttlMs: number,
              private readonly now: () => number = Date.now) {}
  async get(): Promise<AlertMode> {
    if (this.last && this.now() < this.expiresAt) return this.last;
    try {
      const mode = await this.fetchMode();
      if (mode !== "broadcast" && mode !== "leads") throw new Error(`Invalid alert mode: ${mode}`);
      this.last = mode;
      this.expiresAt = this.now() + this.ttlMs;
      return mode;
    } catch (error) {
      console.warn("Could not read RCSupport alert mode; using last known/default broadcast:", error);
      return this.last ?? "broadcast";
    }
  }
}
