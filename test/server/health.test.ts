import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
const app = (await import("../../src/server/app.ts")).default;

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

describe("health endpoint without a base path", () => {
  it("reports up at the root", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "up");
  });
});

describe("frontend shell without a build", () => {
  it("answers 404 when index.html is missing", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "Frontend build not found.");
  });
});
