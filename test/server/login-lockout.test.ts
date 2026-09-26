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

function login(password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
}

describe("login lockout over http", () => {
  it("answers 401 for the first failures and 429 once the limit is reached", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await login("wrong-password");
      statuses.push(res.status);
      assert.deepEqual(await res.json(), { error: "Invalid credentials." });
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
  });

  it("refuses the correct password while locked out without setting a cookie", async () => {
    const res = await login("test-password");
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.deepEqual(await res.json(), { error: "Invalid credentials." });
  });

  it("keeps a locked out client from reaching the credential check", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 429);
  });
});
