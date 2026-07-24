import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { Request } from "express";
import { tempEnv } from "./helpers.ts";

tempEnv();
const { logRequest } = await import("../../src/server/logger.ts");

function fakeReq(
  headers: Record<string, string>,
  originalUrl = "/gifselector/api/session",
): Request {
  return {
    ip: "9.9.9.9",
    method: "GET",
    originalUrl,
    get: (name: string) => headers[name.toLowerCase()],
    socket: { remoteAddress: "9.9.9.9" },
  } as unknown as Request;
}

describe("logRequest", () => {
  afterEach(() => mock.restoreAll());

  it("writes a single log line with method, path, ip and user agent", () => {
    const logged: string[] = [];
    mock.method(console, "log", (msg: string) => {
      logged.push(msg);
    });

    logRequest(fakeReq({ referer: "http://example.com", "user-agent": "test-agent" }));

    assert.equal(logged.length, 1);
    assert.match(logged[0], /GET \/gifselector\/api\/session from 9\.9\.9\.9/);
    assert.match(logged[0], /ua=test-agent/);
  });

  it("sanitizes CR/LF out of header values to prevent log injection", () => {
    const logged: string[] = [];
    mock.method(console, "log", (msg: string) => {
      logged.push(msg);
    });

    logRequest(fakeReq({ referer: "evil\r\nINJECTED", "user-agent": "a\nb" }));

    assert.equal(logged.length, 1);
    assert.doesNotMatch(logged[0], /\r|\n/);
    assert.match(logged[0], /referer=evil INJECTED/);
  });
});
