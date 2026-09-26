import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

const storageDir = tempEnv();
delete process.env.BASE_PATH;
fs.mkdirSync(path.join(storageDir, "gifselector.db"));
const app = (await import("../../src/server/app.ts")).default;
const { isDatabaseReady } = await import("../../src/server/database.ts");

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe("health endpoint with an unreadable database", () => {
  it("reports the database as not ready", async () => {
    assert.equal(await isDatabaseReady(), false);
  });

  it("answers 503 degraded as plain text", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 503);
    assert.match(res.headers.get("content-type") || "", /text\/plain/);
    assert.equal(await res.text(), "degraded");
  });
});
