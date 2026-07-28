import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { declaredSizeGif, tempEnv } from "./helpers.ts";

const storageDir = tempEnv({ frontend: true });
process.env.BASE_PATH = "/gifselector";
const app = (await import("../../src/server/app.ts")).default;

const hasMagick = await (async () => {
  try {
    await promisify(execFile)("magick", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

let server: Server;
let baseUrl: string;
let port: number;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}/gifselector`;
});

after(() => {
  server.close();
});

function firstCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

async function withSeededGif(slug: string, run: () => Promise<void>): Promise<void> {
  const { addGif, deleteGifBySlug } = await import("../../src/server/database.ts");
  const filename = `${slug}.gif`;
  fs.writeFileSync(path.join(storageDir, "uploads", filename), Buffer.from("GIF89a"));
  await addGif({
    slug,
    filename,
    originalName: filename,
    mimeType: "image/gif",
    sizeBytes: 6,
  });
  try {
    await run();
  } finally {
    await deleteGifBySlug(slug);
    fs.rmSync(path.join(storageDir, "uploads", filename), { force: true });
  }
}

async function adminCookie(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  return firstCookie(res);
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

  it("rejects an upload whose bytes are not really an image", async () => {
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    const cookie = firstCookie(loginRes);

    const form = new FormData();
    form.set(
      "gif",
      new Blob([new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])], {
        type: "image/gif",
      }),
      "payload.gif",
    );

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not a valid GIF or WebP/);

    const gifsRes = await fetch(`${baseUrl}/api/gifs`, { headers: { cookie } });
    const gifsBody = (await gifsRes.json()) as { total: number };
    assert.equal(gifsBody.total, 0);

    assert.deepEqual(fs.readdirSync(path.join(storageDir, "uploads")), []);
  });

  it("keeps share redirects relative so the Host header cannot steer them", async () => {
    await withSeededGif("redirect-me", async () => {
      const raw = await new Promise<string>((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.write(
            "GET /gifselector/share/redirect-me HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n",
          );
        });
        let buffer = "";
        socket.on("data", (chunk) => (buffer += chunk));
        socket.on("close", () => resolve(buffer));
      });
      const location = raw.split("\r\n").find((line) => line.startsWith("Location:"));
      assert.equal(location, "Location: /gifselector/share/redirect-me.gif");
    });
  });

  it("ignores a bogus x-forwarded-proto instead of emitting it as a scheme", async () => {
    await withSeededGif("proto-me", async () => {
      const res = await fetch(`${baseUrl}/share/proto-me`, {
        redirect: "manual",
        headers: { "x-forwarded-proto": "javascript" },
      });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get("location"), "/gifselector/share/proto-me.gif");
    });
  });

  it("strips newlines from a slug so the access log cannot be forged", async () => {
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      await fetch(`${baseUrl}/share/aaa%0A%5Bshare-access%5D+slug%3DFAKE.gif`);
    } finally {
      console.log = original;
    }
    const shareLines = written.filter((line) => line.startsWith("[share-access]"));
    assert.equal(shareLines.length, 1);
    assert.ok(!shareLines[0].includes("\n"));
  });

  it("rejects an import with no body as a client error", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/import`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 400);
  });

  it("answers an oversized json body with 413 rather than 500", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(200 * 1024) }),
    });
    assert.equal(res.status, 413);
  });

  it("caps the length of a category name", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "y".repeat(500) }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /100 characters or fewer/);
  });

  it("caps how many urls one import request may carry", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: Array(500).fill("https://tenor.com/view/x") }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /At most 20 urls/);
  });

  it(
    "strips metadata and appended payloads from an accepted upload",
    { skip: !hasMagick },
    async () => {
      const cookie = await adminCookie();
      const source = path.join(storageDir, "payload-source.gif");
      await promisify(execFile)("magick", [
        "-size",
        "32x32",
        "xc:red",
        "xc:blue",
        "-delay",
        "10",
        "-set",
        "comment",
        "SECRET_METADATA_PAYLOAD",
        source,
      ]);
      fs.appendFileSync(source, "\n<script>alert(document.domain)</script>");
      const dirty = fs.readFileSync(source);

      const form = new FormData();
      form.set("gif", new Blob([new Uint8Array(dirty)], { type: "image/gif" }), "payload.gif");
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      assert.equal(res.status, 201);

      const stored = fs.readFileSync(
        path.join(storageDir, "uploads", fs.readdirSync(path.join(storageDir, "uploads"))[0]),
      );
      assert.ok(!stored.includes(Buffer.from("SECRET_METADATA_PAYLOAD")));
      assert.ok(!stored.includes(Buffer.from("<script>")));
      assert.ok(stored.subarray(0, 6).toString("latin1").startsWith("GIF8"));

      const slug = ((await res.json()) as { slug: string }).slug;
      await fetch(`${baseUrl}/api/gifs/${slug}`, { method: "DELETE", headers: { cookie } });
      fs.rmSync(source, { force: true });
    },
  );

  it(
    "rejects a decompression bomb on pixel count, not file size",
    { skip: !hasMagick },
    async () => {
      const cookie = await adminCookie();
      const bytes = declaredSizeGif(20000, 20000);
      assert.ok(bytes.length < 100);

      const form = new FormData();
      form.set("gif", new Blob([new Uint8Array(bytes)], { type: "image/gif" }), "bomb.gif");
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as { error: string }).error, /megapixel budget/);
      assert.deepEqual(fs.readdirSync(path.join(storageDir, "uploads")), []);
    },
  );

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
