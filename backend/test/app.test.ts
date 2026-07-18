import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv({ frontend: true });
const app = (await import("../src/app.ts")).default;

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/gifselector`;
});

after(() => {
  server.close();
});

function firstCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

describe("http api", () => {
  it("reports an unauthenticated session", async () => {
    const res = await fetch(`${baseUrl}/api/session`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { authenticated: false });
  });

  it("guards protected routes without a token", async () => {
    const res = await fetch(`${baseUrl}/api/gifs`);
    assert.equal(res.status, 401);
  });

  it("rejects invalid credentials", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "nope" }),
    });
    assert.equal(res.status, 401);
  });

  it("logs in and drives an authenticated category flow", async () => {
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = firstCookie(loginRes);
    assert.match(cookie, /^authToken=/);

    const createRes = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Reactions" }),
    });
    assert.equal(createRes.status, 201);

    const dupRes = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Reactions" }),
    });
    assert.equal(dupRes.status, 409);

    const listRes = await fetch(`${baseUrl}/api/categories`, { headers: { cookie } });
    const listBody = (await listRes.json()) as { categories: unknown[] };
    assert.equal(listBody.categories.length, 1);

    const gifsRes = await fetch(`${baseUrl}/api/gifs`, { headers: { cookie } });
    assert.deepEqual(await gifsRes.json(), { gifs: [], total: 0 });
  });

  it("serves the frontend shell at the base path", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /gifselector/);
  });

  it("returns 404 for unknown non-api paths", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(res.status, 404);
  });
});
