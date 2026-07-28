import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUserRateLimiter } from "../../src/discord/rate-limit.ts";

describe("createUserRateLimiter", () => {
  it("grants requests up to the allowance", () => {
    const limiter = createUserRateLimiter(3, 60_000);
    assert.equal(limiter.take("user-a", 1, 0).allowed, 1);
    assert.equal(limiter.take("user-a", 1, 0).allowed, 1);
    assert.equal(limiter.take("user-a", 1, 0).allowed, 1);
    assert.equal(limiter.take("user-a", 1, 0).allowed, 0);
  });

  it("partially grants a batch that overruns the allowance", () => {
    const limiter = createUserRateLimiter(3, 60_000);
    assert.equal(limiter.take("user-a", 5, 0).allowed, 3);
    assert.equal(limiter.take("user-a", 2, 0).allowed, 0);
  });

  it("counts each user separately", () => {
    const limiter = createUserRateLimiter(2, 60_000);
    assert.equal(limiter.take("user-a", 2, 0).allowed, 2);
    assert.equal(limiter.take("user-a", 1, 0).allowed, 0);
    assert.equal(limiter.take("user-b", 2, 0).allowed, 2);
  });

  it("refills once the window has passed", () => {
    const limiter = createUserRateLimiter(2, 60_000);
    assert.equal(limiter.take("user-a", 2, 0).allowed, 2);
    assert.equal(limiter.take("user-a", 1, 59_999).allowed, 0);
    assert.equal(limiter.take("user-a", 2, 60_000).allowed, 2);
  });

  it("reports the seconds left in the window", () => {
    const limiter = createUserRateLimiter(1, 600_000);
    assert.equal(limiter.take("user-a", 1, 0).retryAfterSeconds, 600);
    assert.equal(limiter.take("user-a", 1, 599_000).retryAfterSeconds, 1);
  });

  it("keys the window to the first request, not the last", () => {
    const limiter = createUserRateLimiter(2, 60_000);
    limiter.take("user-a", 1, 0);
    limiter.take("user-a", 1, 30_000);
    assert.equal(limiter.take("user-a", 1, 45_000).allowed, 0);
    assert.equal(limiter.take("user-a", 1, 60_000).allowed, 1);
  });
});
