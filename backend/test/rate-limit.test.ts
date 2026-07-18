import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "../src/rate-limit.ts";

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
  set(key: string, value: string): MockRes;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    set(key, value) {
      res.headers[key] = value;
      return res;
    },
  };
  return res;
}

function reqFrom(ip: string): Request {
  return { ip } as unknown as Request;
}

describe("createRateLimiter", () => {
  it("allows requests under the limit and blocks the ones over it", () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    const req = reqFrom("1.1.1.1");
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as unknown as NextFunction;

    const r1 = mockRes();
    limiter(req, r1 as unknown as Response, next);
    const r2 = mockRes();
    limiter(req, r2 as unknown as Response, next);
    const r3 = mockRes();
    limiter(req, r3 as unknown as Response, next);

    assert.equal(nextCalls, 2);
    assert.equal(r3.statusCode, 429);
    assert.equal(r3.headers["Retry-After"] !== undefined, true);
  });

  it("tracks limits independently per client ip", () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    const next = (() => {}) as unknown as NextFunction;

    const a = mockRes();
    limiter(reqFrom("2.2.2.2"), a as unknown as Response, next);
    const b = mockRes();
    limiter(reqFrom("3.3.3.3"), b as unknown as Response, next);

    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
  });
});
