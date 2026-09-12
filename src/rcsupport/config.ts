import fs from "node:fs";
import https from "node:https";

export interface BridgeConfig {
  baseUrl: URL;
  token: string;
  agent: https.Agent;
  pollIntervalMs: number;
  alertModeCacheMs: number;
  forumChannelId: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`RCSupport requires ${name}`);
  return value;
}

function interval(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1000) throw new Error(`${name} must be an integer >= 1000`);
  return value;
}

export function loadBridgeConfig(): BridgeConfig {
  const baseUrl = new URL(process.env.RCSUPPORT_API_BASE_URL || "https://127.0.0.1:28120");
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password)
    throw new Error("RCSUPPORT_API_BASE_URL must be an HTTPS URL without credentials");
  const token = required("RCSUPPORT_API_TOKEN");
  const caPath = required("RCSUPPORT_API_CA_CERT_PATH");
  const forumChannelId = required("RCSUPPORT_FORUM_CHANNEL_ID");
  let ca: Buffer;
  try { ca = fs.readFileSync(caPath); }
  catch (error) { throw new Error(`Cannot read RCSUPPORT_API_CA_CERT_PATH at ${caPath}: ${error}`); }
  if (!ca.toString("utf8").includes("-----BEGIN CERTIFICATE-----"))
    throw new Error("RCSUPPORT_API_CA_CERT_PATH must contain a PEM certificate");
  return {
    baseUrl, token, forumChannelId,
    // The supplied self-signed certificate is the only CA for this client.
    agent: new https.Agent({ ca, rejectUnauthorized: true }),
    pollIntervalMs: interval("RCSUPPORT_POLL_INTERVAL_MS", 20000),
    alertModeCacheMs: interval("RCSUPPORT_ALERT_MODE_CACHE_MS", 60000),
  };
}
