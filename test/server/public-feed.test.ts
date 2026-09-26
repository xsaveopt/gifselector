import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
delete process.env.BASE_PATH;
process.env.GIFS_PUBLIC_CATEGORY = "Public";

const express = (await import("express")).default;
const config = (await import("../../src/server/config.ts")).default;
const routes = (await import("../../src/server/routes.ts")).default;
const { addCategory, addGif, setGifCategories } = await import("../../src/server/database.ts");

const app = express();
app.use(routes);

const GIF_COUNT = 80;
const LONG_NAME = "n".repeat(300);

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const category = await addCategory("Public");
  for (let index = 0; index < GIF_COUNT; index++) {
    const slug = `feed-${index}`;
    await addGif({
      slug,
      filename: `${slug}.gif`,
      originalName: `${LONG_NAME}-${index}.gif`,
      mimeType: "image/gif",
      sizeBytes: 22,
    });
    await setGifCategories(slug, [category?.id]);
  }
});

after(() => {
  server.close();
});

let requestsSent = 0;

async function getFeed(): Promise<Response> {
  requestsSent += 1;
  return fetch(`${baseUrl}/api/public/gifs`);
}

describe("public feed throttling", () => {
  it("paces a large payload to the configured speed limit", async () => {
    const configured = config.PUBLIC_API_SPEED_LIMIT;
    config.PUBLIC_API_SPEED_LIMIT = 64 * 1024;
    try {
      const started = Date.now();
      const res = await getFeed();
      const text = await res.text();
      const elapsed = Date.now() - started;

      assert.equal(res.status, 200);
      const bytes = Buffer.byteLength(text, "utf-8");
      assert.ok(bytes > 32 * 1024);
      assert.equal(Number(res.headers.get("content-length")), bytes);
      const pausedChunks = Math.ceil(bytes / (16 * 1024)) - 1;
      assert.ok(elapsed >= pausedChunks * 250 * 0.9);

      const body = JSON.parse(text) as { gifs: { slug: string }[] };
      assert.equal(body.gifs.length, GIF_COUNT);
    } finally {
      config.PUBLIC_API_SPEED_LIMIT = configured;
    }
  });
});

describe("public feed rate limit", () => {
  it("allows sixty requests a minute and then answers 429 with Retry-After", async () => {
    while (requestsSent < 60) {
      const res = await getFeed();
      await res.arrayBuffer();
      assert.equal(res.status, 200);
    }
    const limited = await getFeed();
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "Too many requests." });
    const retryAfter = Number(limited.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 60);
  });
});
