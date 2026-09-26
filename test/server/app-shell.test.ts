import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

const storageDir = tempEnv();
const distDir = path.join(storageDir, "dist");
delete process.env.BASE_PATH;
process.env.GIFS_PUBLIC_ORIGIN = "https://gifs.example.com/ignored";
process.env.GIFS_DEFAULT_CATEGORY_ID = "7";
fs.writeFileSync(path.join(distDir, "index.html"), '<div id="root"></div>');
fs.mkdirSync(path.join(distDir, "assets"));
fs.writeFileSync(path.join(distDir, "assets", "app.js"), "console.log(1);");
fs.writeFileSync(path.join(distDir, "assets", "logo.png"), Buffer.from([0x89, 0x50]));

const app = (await import("../../src/server/app.ts")).default;
const { addGif, deleteGifBySlug } = await import("../../src/server/database.ts");

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

const expectedRuntime =
  '<base href="/" /><script>window.__BASE__="";window.__DEFAULT_CATEGORY__=7;</script>';

describe("frontend shell without a head element", () => {
  it("prepends the runtime settings to the built html", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await res.text(), `${expectedRuntime}<div id="root"></div>`);
  });

  it("serves the same shell for the public gallery routes", async () => {
    for (const route of ["/public", "/public/anything"]) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 200, route);
      assert.equal(await res.text(), `${expectedRuntime}<div id="root"></div>`, route);
    }
  });

  it("keeps serving the cached shell after the file changes on disk", async () => {
    fs.writeFileSync(path.join(distDir, "index.html"), "<p>changed</p>");
    const res = await fetch(`${baseUrl}/`);
    assert.equal(await res.text(), `${expectedRuntime}<div id="root"></div>`);
  });
});

describe("static assets", () => {
  it("serves built scripts and images with a one year immutable cache", async () => {
    for (const asset of ["/assets/app.js", "/assets/logo.png"]) {
      const res = await fetch(`${baseUrl}${asset}`);
      assert.equal(res.status, 200, asset);
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable", asset);
      await res.arrayBuffer();
    }
  });

  it("leaves unknown api paths to the router instead of the spa fallback", async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /Cannot GET \/api\/does-not-exist/);
  });
});

describe("share urls with GIFS_PUBLIC_ORIGIN", () => {
  it("builds share links from the configured origin, not the request host", async () => {
    const slug = "origin-me";
    fs.writeFileSync(path.join(storageDir, "uploads", `${slug}.gif`), Buffer.from("GIF89a"));
    await addGif({
      slug,
      filename: `${slug}.gif`,
      originalName: `${slug}.gif`,
      mimeType: "image/gif",
      sizeBytes: 6,
    });
    try {
      const login = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test-password" }),
      });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      const res = await fetch(`${baseUrl}/api/gifs`, {
        headers: { cookie, "x-forwarded-proto": "http" },
      });
      const body = (await res.json()) as { gifs: Array<{ shareUrl: string }> };
      assert.deepEqual(
        body.gifs.map((gif) => gif.shareUrl),
        ["https://gifs.example.com/share/origin-me.gif"],
      );
    } finally {
      await deleteGifBySlug(slug);
    }
  });
});
