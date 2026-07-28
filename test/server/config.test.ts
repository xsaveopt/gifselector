import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
process.env.GIFS_ALLOWED_DOMAINS = " Example.com, foo.org ,, bar.net ";
process.env.GIFS_MAX_FILE_SIZE_MB = "4";
process.env.DISCORD_RATE_LIMIT_MAX = "7";
process.env.DISCORD_RATE_LIMIT_WINDOW_MINUTES = "3";
const config = (await import("../../src/server/config.ts")).default;

describe("config.ALLOWED_IMPORT_DOMAINS", () => {
  it("parses a comma-separated env var into trimmed, lowercased domains", () => {
    assert.deepEqual(config.ALLOWED_IMPORT_DOMAINS, ["example.com", "foo.org", "bar.net"]);
  });
});

describe("config size and rate limits", () => {
  it("resolves the file size limit into bytes", () => {
    assert.equal(config.MAX_FILE_SIZE_MB, 4);
    assert.equal(config.MAX_FILE_SIZE_BYTES, 4 * 1024 * 1024);
  });

  it("resolves the discord allowance and window", () => {
    assert.equal(config.DISCORD_RATE_LIMIT_MAX, 7);
    assert.equal(config.DISCORD_RATE_LIMIT_WINDOW_MS, 3 * 60 * 1000);
  });
});
