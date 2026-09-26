import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { fakeExec, gifBytes, tempEnv, webpBytes } from "./helpers.ts";
import type { FakeExec } from "./helpers.ts";

const storageDir = tempEnv();
process.env.BASE_PATH = "/gifs";
process.env.GIFS_PUBLIC_CATEGORY = "Public";

const express = (await import("express")).default;
const cookieParser = (await import("cookie-parser")).default;
const config = (await import("../../src/server/config.ts")).default;
const { mediaExec } = await import("../../src/server/media-guard.ts");
const { importNet } = await import("../../src/server/importer.ts");
const routes = await import("../../src/server/routes.ts");
const { addCategory, addGif, deleteGifBySlug, listCategories, listGifs, setGifCategories } =
  await import("../../src/server/database.ts");

const uploadDir = path.join(storageDir, "uploads");

const app = express();
app.use(cookieParser());
app.use(routes.default);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : "unknown" });
});

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mediaExec.run = fakeExec().run;
  importNet.fetch = async () => {
    throw new Error("the fallback fetch should not run in these tests");
  };
});

after(() => {
  server.close();
});

function firstCookie(res: globalThis.Response): string {
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

async function adminCookie(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  return firstCookie(res);
}

async function seedGif(slug: string, filename: string): Promise<void> {
  fs.writeFileSync(path.join(uploadDir, filename), gifBytes());
  await addGif({
    slug,
    filename,
    originalName: filename,
    mimeType: path.extname(filename) === ".webp" ? "image/webp" : "image/gif",
    sizeBytes: 22,
  });
}

describe("buildSharePath", () => {
  it("prefixes the base path and uses the stored extension", () => {
    assert.equal(routes.buildSharePath("abc", "1700-x.webp"), "/gifs/share/abc.webp");
    assert.equal(routes.buildSharePath("abc", "1700-x.gif"), "/gifs/share/abc.gif");
    assert.equal(routes.buildSharePath("abc", "1700-x.bin"), "/gifs/share/abc.gif");
  });
});

describe("session routes", () => {
  it("requires both credentials", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin" }),
    });
    assert.equal(res.status, 400);
  });

  it("reports the logged in username", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
    assert.deepEqual(await res.json(), { authenticated: true, username: "admin" });
  });

  it("treats a forged token as anonymous", async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      headers: { cookie: "authToken=not.a.jwt" },
    });
    assert.deepEqual(await res.json(), { authenticated: false });
  });

  it("clears the cookie on logout", async () => {
    const res = await fetch(`${baseUrl}/api/logout`, { method: "POST" });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") || "";
    assert.match(setCookie, /^authToken=;/);
  });
});

describe("gif listing", () => {
  it("builds share urls from the request host", async () => {
    const cookie = await adminCookie();
    await seedGif("listed", "listed.gif");
    try {
      const res = await fetch(`${baseUrl}/api/gifs`, { headers: { cookie } });
      const body = (await res.json()) as { gifs: { shareUrl: string }[]; total: number };
      assert.equal(body.total, 1);
      assert.equal(body.gifs[0].shareUrl, `${baseUrl}/gifs/share/listed.gif`);
    } finally {
      await deleteGifBySlug("listed");
    }
  });

  it("honours a forwarded https scheme", async () => {
    const cookie = await adminCookie();
    await seedGif("forwarded", "forwarded.gif");
    try {
      const res = await fetch(`${baseUrl}/api/gifs`, {
        headers: { cookie, "x-forwarded-proto": "https, http" },
      });
      const body = (await res.json()) as { gifs: { shareUrl: string }[] };
      assert.match(body.gifs[0].shareUrl, /^https:\/\/127\.0\.0\.1:\d+\/gifs\/share\//);
    } finally {
      await deleteGifBySlug("forwarded");
    }
  });
});

describe("public gif feed", () => {
  it("serves the configured category as throttled json", async () => {
    const category = await listCategories().then(
      (existing) => existing.find((row) => row.name === "Public") ?? addCategory("Public"),
    );
    await seedGif("public-one", "public-one.gif");
    await setGifCategories("public-one", [category?.id]);
    try {
      const res = await fetch(`${baseUrl}/api/public/gifs`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /application\/json/);
      assert.match(res.headers.get("cache-control") || "", /immutable/);
      const body = (await res.json()) as { gifs: { slug: string; shareUrl: string }[] };
      assert.equal(body.gifs.length, 1);
      assert.equal(body.gifs[0].slug, "public-one");
    } finally {
      await deleteGifBySlug("public-one");
    }
  });

  it("answers 404 when no public category is configured", async () => {
    const configured = config.PUBLIC_CATEGORY;
    config.PUBLIC_CATEGORY = undefined;
    try {
      const res = await fetch(`${baseUrl}/api/public/gifs`);
      assert.equal(res.status, 404);
    } finally {
      config.PUBLIC_CATEGORY = configured;
    }
  });
});

describe("category routes", () => {
  it("rejects a missing name", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it("rejects a category id that is not a positive integer", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/categories/abc`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /Invalid category id/);
  });

  it("answers 404 for a category that does not exist", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/categories/98765`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 404);
  });

  it("creates and deletes a category", async () => {
    const cookie = await adminCookie();
    const created = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Throwaway" }),
    });
    assert.equal(created.status, 201);
    const { category } = (await created.json()) as { category: { id: number } };

    const deleted = await fetch(`${baseUrl}/api/categories/${category.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(deleted.status, 200);
    const names = (await listCategories()).map((row) => row.name);
    assert.ok(!names.includes("Throwaway"));
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/categories`);
    assert.equal(res.status, 401);
  });
});

describe("gif category assignment", () => {
  it("answers 404 for an unknown slug", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/gifs/nope/categories`, {
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIds: [] }),
    });
    assert.equal(res.status, 404);
  });

  it("rejects a category that does not exist", async () => {
    const cookie = await adminCookie();
    await seedGif("assignable", "assignable.gif");
    try {
      const res = await fetch(`${baseUrl}/api/gifs/assignable/categories`, {
        method: "PUT",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: [4242] }),
      });
      assert.equal(res.status, 400);
    } finally {
      await deleteGifBySlug("assignable");
    }
  });

  it("stores the assignment", async () => {
    const cookie = await adminCookie();
    const category = await addCategory("Assigned");
    await seedGif("tagged", "tagged.gif");
    try {
      const res = await fetch(`${baseUrl}/api/gifs/tagged/categories`, {
        method: "PUT",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: [category?.id] }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { categories: { name: string }[] };
      assert.deepEqual(
        body.categories.map((row) => row.name),
        ["Assigned"],
      );
    } finally {
      await deleteGifBySlug("tagged");
    }
  });
});

describe("share routes", () => {
  it("redirects a bare slug to the canonical extension", async () => {
    await seedGif("bare", "bare.gif");
    try {
      const res = await fetch(`${baseUrl}/share/bare`, { redirect: "manual" });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get("location"), "/gifs/share/bare.gif");
    } finally {
      await deleteGifBySlug("bare");
    }
  });

  it("redirects when the requested extension does not match the stored one", async () => {
    await seedGif("wrongext", "wrongext.webp");
    try {
      const res = await fetch(`${baseUrl}/share/wrongext.gif`, { redirect: "manual" });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get("location"), "/gifs/share/wrongext.webp");
    } finally {
      await deleteGifBySlug("wrongext");
    }
  });

  it("serves the stored bytes with immutable caching", async () => {
    await seedGif("served", "served.gif");
    try {
      const res = await fetch(`${baseUrl}/share/served.gif`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /image\/gif/);
      assert.match(res.headers.get("cache-control") || "", /immutable/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, 6).toString("latin1"), "GIF89a");
    } finally {
      await deleteGifBySlug("served");
    }
  });

  it("answers 404 for an unknown slug", async () => {
    const res = await fetch(`${baseUrl}/share/missing.gif`);
    assert.equal(res.status, 404);
  });

  it("answers 404 when the row exists but the file is gone", async () => {
    await seedGif("ghost", "ghost.gif");
    fs.rmSync(path.join(uploadDir, "ghost.gif"));
    try {
      const res = await fetch(`${baseUrl}/share/ghost.gif`);
      assert.equal(res.status, 404);
      assert.match(((await res.json()) as { error: string }).error, /file missing/);
    } finally {
      await deleteGifBySlug("ghost");
    }
  });
});

describe("delete route", () => {
  it("answers 404 for an unknown slug", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/gifs/nothing-here`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 404);
  });

  it("removes the row and the file", async () => {
    const cookie = await adminCookie();
    await seedGif("removable", "removable.gif");
    const res = await fetch(`${baseUrl}/api/gifs/removable`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(path.join(uploadDir, "removable.gif")), false);
  });
});

describe("upload route", () => {
  it("rejects a request with no file", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: new FormData(),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /No file uploaded/);
  });

  it("rejects a mime type that is not gif or webp", async () => {
    const cookie = await adminCookie();
    const form = new FormData();
    form.set("gif", new Blob([new Uint8Array(gifBytes())], { type: "image/png" }), "a.png");
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /Only GIF or WebP/);
  });

  it("stores an accepted upload and answers with its share url", async () => {
    const cookie = await adminCookie();
    const form = new FormData();
    form.set("gif", new Blob([new Uint8Array(webpBytes())], { type: "image/webp" }), "clip.webp");
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { slug: string; shareUrl: string };
    assert.equal(body.shareUrl, `${baseUrl}/gifs/share/${body.slug}.webp`);

    const listed = await fetch(`${baseUrl}/api/gifs`, { headers: { cookie } });
    const gifs = (await listed.json()) as { gifs: { slug: string; mimeType: string }[] };
    const stored = gifs.gifs.find((gif) => gif.slug === body.slug);
    assert.equal(stored?.mimeType, "image/webp");

    await fetch(`${baseUrl}/api/gifs/${body.slug}`, { method: "DELETE", headers: { cookie } });
  });

  it("renames an upload whose extension disagrees with its bytes", async () => {
    const cookie = await adminCookie();
    const form = new FormData();
    form.set("gif", new Blob([new Uint8Array(gifBytes())], { type: "image/webp" }), "lying.webp");
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { slug: string; shareUrl: string };
    assert.match(body.shareUrl, /\.gif$/);

    await fetch(`${baseUrl}/api/gifs/${body.slug}`, { method: "DELETE", headers: { cookie } });
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/upload`, { method: "POST", body: new FormData() });
    assert.equal(res.status, 401);
  });
});

describe("import route", () => {
  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [] }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects a payload whose urls are not an array", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: "https://tenor.com/view/x" }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /must be an array/);
  });

  it("returns one result per url, successes and failures alike", async () => {
    const cookie = await adminCookie();
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://tenor.com/view/ok", "https://evil.test/a.gif"] }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      results: { success: boolean; slug?: string; error?: string }[];
    };
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].success, true);
    assert.equal(body.results[1].success, false);
    assert.equal(body.results[1].error, "Domain not whitelisted");

    await fetch(`${baseUrl}/api/gifs/${body.results[0].slug}`, {
      method: "DELETE",
      headers: { cookie },
    });
  });
});

function uploadForm(bytes: Buffer, type: string, name: string): FormData {
  const form = new FormData();
  form.set("gif", new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

async function withMediaExec(run: FakeExec["run"], body: () => Promise<void>): Promise<void> {
  const previous = mediaExec.run;
  mediaExec.run = run;
  try {
    await body();
  } finally {
    mediaExec.run = previous;
  }
}

async function waitFor(check: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

describe("upload cleanup", () => {
  it("removes the stored file when sanitizing fails", async () => {
    const cookie = await adminCookie();
    const before = fs.readdirSync(uploadDir).sort();
    await withMediaExec(fakeExec({ magick: false }).run, async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(gifBytes(), "image/gif", "unsanitizable.gif"),
      });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as { error: string }).error, /magick exited/);
    });
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), before);
    const names = (await listGifs()).map((gif) => gif.originalName);
    assert.ok(!names.includes("unsanitizable.gif"));
  });

  it("removes the renamed file when validation fails after a rename", async () => {
    const cookie = await adminCookie();
    const before = fs.readdirSync(uploadDir).sort();
    const fake = fakeExec();
    const run: FakeExec["run"] = async (file, args, options) => {
      if (args.includes("-strip")) {
        throw new Error("magick exited with code 1");
      }
      return fake.run(file, args, options);
    };
    await withMediaExec(run, async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(gifBytes(), "image/webp", "renamed-then-failed.webp"),
      });
      assert.equal(res.status, 400);
    });
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), before);
  });

  it("removes the stored file when the database write fails", async () => {
    const cookie = await adminCookie();
    const before = fs.readdirSync(uploadDir).sort();
    const dbPath = path.join(storageDir, "gifselector.db");
    const saved = fs.readFileSync(dbPath);
    fs.rmSync(dbPath);
    fs.mkdirSync(dbPath);
    let status = 0;
    try {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(gifBytes(), "image/gif", "db-write-fails.gif"),
      });
      status = res.status;
      await res.arrayBuffer();
    } finally {
      fs.rmSync(dbPath, { recursive: true, force: true });
      fs.writeFileSync(dbPath, saved);
    }
    for (const gif of await listGifs()) {
      if (gif.originalName === "db-write-fails.gif") {
        await deleteGifBySlug(gif.slug);
      }
    }
    assert.equal(status, 500);
    const cleaned = await waitFor(
      () => fs.readdirSync(uploadDir).sort().join("\n") === before.join("\n"),
    );
    assert.equal(cleaned, true);
  });

  it("does not list a gif whose database write failed", async () => {
    const cookie = await adminCookie();
    const dbPath = path.join(storageDir, "gifselector.db");
    const saved = fs.readFileSync(dbPath);
    fs.rmSync(dbPath);
    fs.mkdirSync(dbPath);
    try {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(gifBytes(), "image/gif", "db-write-orphan.gif"),
      });
      assert.equal(res.status, 500);
    } finally {
      fs.rmSync(dbPath, { recursive: true, force: true });
      fs.writeFileSync(dbPath, saved);
    }
    const orphans = (await listGifs()).filter((gif) => gif.originalName === "db-write-orphan.gif");
    for (const orphan of orphans) {
      await deleteGifBySlug(orphan.slug);
    }
    assert.equal(orphans.length, 0);
  });
});

describe("upload animation pass", () => {
  it("turns a still webp into an animated gif", async () => {
    const cookie = await adminCookie();
    const before = new Set(fs.readdirSync(uploadDir));
    await withMediaExec(fakeExec({ frames: 1 }).run, async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(webpBytes(), "image/webp", "still.webp"),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { slug: string; shareUrl: string };
      assert.match(body.shareUrl, /\.gif$/);

      const stored = (await listGifs()).find((gif) => gif.slug === body.slug);
      assert.equal(stored?.mimeType, "image/gif");
      assert.match(stored?.filename ?? "", /\.gif$/);
      assert.equal(stored?.sizeBytes, gifBytes().length);
      const added = fs.readdirSync(uploadDir).filter((entry) => !before.has(entry));
      assert.deepEqual(added, [stored?.filename]);

      await deleteGifBySlug(body.slug);
      fs.rmSync(path.join(uploadDir, stored?.filename ?? ""), { force: true });
    });
  });

  it("keeps the original upload when the animation pass fails", async () => {
    const cookie = await adminCookie();
    const before = new Set(fs.readdirSync(uploadDir));
    const fake = fakeExec({ frames: 1 });
    const run: FakeExec["run"] = async (file, args, options) => {
      if (args.includes("-duplicate")) {
        throw new Error("magick exited with code 1");
      }
      return fake.run(file, args, options);
    };
    await withMediaExec(run, async () => {
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { cookie },
        body: uploadForm(webpBytes(), "image/webp", "stubborn.webp"),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { slug: string; shareUrl: string };
      assert.match(body.shareUrl, /\.webp$/);

      const stored = (await listGifs()).find((gif) => gif.slug === body.slug);
      assert.equal(stored?.mimeType, "image/webp");
      const added = fs.readdirSync(uploadDir).filter((entry) => !before.has(entry));
      assert.deepEqual(added, [stored?.filename]);

      await deleteGifBySlug(body.slug);
      fs.rmSync(path.join(uploadDir, stored?.filename ?? ""), { force: true });
    });
  });
});

function rawGet(pathname: string, headers: Record<string, string>): Promise<string> {
  const port = (server.address() as AddressInfo).port;
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n${lines.join("\r\n")}\r\nConnection: close\r\n\r\n`,
      );
    });
    let buffer = "";
    socket.on("data", (chunk) => (buffer += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(buffer));
  });
}

describe("share url origin", () => {
  it("falls back to a relative share url when the Host header is malformed", async () => {
    const cookie = await adminCookie();
    await seedGif("badhost", "badhost.gif");
    try {
      const raw = await rawGet("/api/gifs", {
        Host: "evil.example.com@attacker.example",
        Cookie: cookie,
      });
      const body = JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as {
        gifs: { slug: string; shareUrl: string }[];
      };
      const listed = body.gifs.find((gif) => gif.slug === "badhost");
      assert.equal(listed?.shareUrl, "/gifs/share/badhost.gif");
    } finally {
      await deleteGifBySlug("badhost");
    }
  });

  it("prefers the configured public origin over the request host", async () => {
    const cookie = await adminCookie();
    const configured = config.PUBLIC_ORIGIN;
    config.PUBLIC_ORIGIN = "https://gifs.example.com";
    await seedGif("pinned-origin", "pinned-origin.gif");
    try {
      const res = await fetch(`${baseUrl}/api/gifs`, {
        headers: { cookie, "x-forwarded-proto": "http" },
      });
      const body = (await res.json()) as { gifs: { slug: string; shareUrl: string }[] };
      const listed = body.gifs.find((gif) => gif.slug === "pinned-origin");
      assert.equal(listed?.shareUrl, "https://gifs.example.com/gifs/share/pinned-origin.gif");
    } finally {
      config.PUBLIC_ORIGIN = configured;
      await deleteGifBySlug("pinned-origin");
    }
  });
});

describe("category conflicts", () => {
  it("answers 409 for a name that only differs by surrounding whitespace", async () => {
    const cookie = await adminCookie();
    const first = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Conflicted" }),
    });
    assert.equal(first.status, 201);
    const second = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  Conflicted  " }),
    });
    assert.equal(second.status, 409);
    assert.match(((await second.json()) as { error: string }).error, /already exists/);
  });
});
