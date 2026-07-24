import fs from "node:fs";
import type { Request } from "express";
import config from "./config.ts";

function sanitize(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, " ");
}

export function logRequest(req: Request): void {
  const timestamp = new Date().toISOString();
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown-ip";
  const referer = sanitize(req.get("referer") || req.get("referrer") || "no-referer");
  const userAgent = sanitize(req.get("user-agent") || "no-user-agent");
  const target = sanitize(req.originalUrl);

  const logMessage = `[${timestamp}] ${req.method} ${target} from ${clientIp} referer=${referer} ua=${userAgent}`;

  console.log(logMessage);

  if (config.ENABLE_FILE_LOGGING) {
    try {
      fs.appendFileSync(config.LOG_FILE_PATH, logMessage + "\n");
    } catch (err) {
      console.error("Failed to write to log file", err);
    }
  }
}
