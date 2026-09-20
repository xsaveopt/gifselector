import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { fakeExec, gifBytes, tempEnv, webpBytes } from "./helpers.ts";

const storageDir = tempEnv();
process.env.BASE_PATH = "/gifs";
process.env.GIFS_PUBLIC_CATEGORY = "Public";

const express = (await import("express")).default;
const cookieParser = (await import("cookie-parser")).default;
const config = (await import("../../src/server/config.ts")).default;
const { mediaExec } = await import("../../src/server/media-guard.ts");
const { importNet } = await import("../../src/server/importer.ts");
const routes = await import("../../src/server/routes.ts");
const { addCategory, addGif, deleteGifBySlug, listCategories, setGifCategories } =
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
