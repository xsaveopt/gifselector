import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { tempEnv } from "./helpers.ts";

tempEnv();
const auth = await import("../src/auth.ts");

function fakeReq(ip: string): Request {
  return { ip } as unknown as Request;
}

describe("auth", () => {
  it("validates correct admin credentials only", () => {
    assert.equal(auth.credentialsAreValid("admin", "test-password"), true);
    assert.equal(auth.credentialsAreValid("admin", "wrong"), false);
    assert.equal(auth.credentialsAreValid("intruder", "test-password"), false);
  });

  it("issues and verifies a JWT round-trip", () => {
    const token = auth.issueToken("admin");
    assert.equal(typeof token, "string");
    assert.equal(auth.verifyToken(token).username, "admin");
  });

  it("rejects a tampered or malformed token", () => {
    assert.throws(() => auth.verifyToken("not.a.jwt"));
  });

  it("locks out after too many failed logins and resets on success", () => {
    const req = fakeReq("10.10.10.10");
    assert.equal(auth.checkLoginRateLimit(req).allowed, true);

    let blocked = false;
    for (let i = 0; i < 5; i++) {
      blocked = auth.recordFailedLogin(req).blocked;
    }
    assert.equal(blocked, true);
    assert.equal(auth.checkLoginRateLimit(req).allowed, false);

    auth.recordSuccessfulLogin(req);
    assert.equal(auth.checkLoginRateLimit(req).allowed, true);
  });

  it("builds hardened cookie options scoped to the base path", () => {
    const opts = auth.cookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.path, "/gifselector");
  });
});
