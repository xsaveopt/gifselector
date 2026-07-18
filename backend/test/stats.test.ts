import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
process.env.ENABLE_FILE_LOGGING = "1";
const config = (await import("../src/config.ts")).default;
const { processStats } = await import("../src/stats.ts");

describe("processStats", () => {
  it("ranks IP addresses and user agents from the access log", () => {
    const lines = [
      "[t] GET /a from 1.1.1.1 referer=x ua=Firefox",
      "[t] GET /b from 1.1.1.1 referer=x ua=Firefox",
      "[t] GET /c from 2.2.2.2 referer=x ua=Chrome",
    ].join("\n");
    fs.writeFileSync(config.LOG_FILE_PATH, lines + "\n");

    processStats();

    const output = fs.readFileSync(config.STATS_FILE_PATH, "utf8");
    assert.match(output, /1\.1\.1\.1: 2/);
    assert.match(output, /2\.2\.2\.2: 1/);
    assert.match(output, /Firefox: 2/);
    assert.match(output, /Chrome: 1/);
  });
});
