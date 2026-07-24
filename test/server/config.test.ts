import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
process.env.GIFS_ALLOWED_DOMAINS = " Example.com, foo.org ,, bar.net ";
const config = (await import("../../src/server/config.ts")).default;

describe("config.ALLOWED_IMPORT_DOMAINS", () => {
  it("parses a comma-separated env var into trimmed, lowercased domains", () => {
    assert.deepEqual(config.ALLOWED_IMPORT_DOMAINS, ["example.com", "foo.org", "bar.net"]);
  });
});
