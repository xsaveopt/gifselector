import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fakeExec, gifBytes, mp4Bytes, tempEnv, webpBytes } from "./helpers.ts";

const storageDir = tempEnv();
process.env.GIFS_MAX_FILE_SIZE_MB = "0.05";

const { mediaExec } = await import("../../src/server/media-guard.ts");
const { ensureAnimated, extensionFromFilename, importFromUrl, importNet, isWhitelistedUrl } =
  await import("../../src/server/importer.ts");
const { findGifBySlug } = await import("../../src/server/database.ts");

const uploadDir = path.join(storageDir, "uploads");
const realExec = mediaExec.run;
const realFetch = importNet.fetch;
const warnings: string[] = [];
let realWarn: typeof console.warn;

beforeEach(() => {
  warnings.length = 0;
  realWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
});

afterEach(() => {
  console.warn = realWarn;
  mediaExec.run = realExec;
  importNet.fetch = realFetch;
  for (const entry of fs.readdirSync(uploadDir)) {
    fs.rmSync(path.join(uploadDir, entry), { force: true });
  }
});

function mediaResponse(bytes: Buffer, contentType: string, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": contentType, ...headers },
  });
}

function htmlResponse(html: string) {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

function stubFetch(responses: Response[]): string[] {
  const seen: string[] = [];
  importNet.fetch = async (urlStr: string) => {
    seen.push(urlStr);
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected fetch for ${urlStr}`);
    }
    return next;
  };
  return seen;
}

describe("isWhitelistedUrl", () => {
  it("accepts configured domains and their subdomains", () => {
    assert.equal(isWhitelistedUrl(new URL("https://tenor.com/view/a")), true);
    assert.equal(isWhitelistedUrl(new URL("https://media.tenor.com/a.gif")), true);
    assert.equal(isWhitelistedUrl(new URL("https://cdn.discordapp.com/a.gif")), true);
  });

  it("rejects lookalike hosts", () => {
    assert.equal(isWhitelistedUrl(new URL("https://nottenor.com/a")), false);
    assert.equal(isWhitelistedUrl(new URL("https://tenor.com.evil.test/a")), false);
    assert.equal(isWhitelistedUrl(new URL("https://evil.test/?x=tenor.com")), false);
  });
});

describe("extensionFromFilename", () => {
  it("keeps allowed extensions and falls back to gif", () => {
    assert.equal(extensionFromFilename("a.webp"), "webp");
    assert.equal(extensionFromFilename("a.GIF"), "gif");
    assert.equal(extensionFromFilename("a.mp4"), "gif");
    assert.equal(extensionFromFilename("noextension"), "gif");
    assert.equal(extensionFromFilename(""), "gif");
  });
});

describe("importFromUrl input validation", () => {
  it("rejects a value that is not a string", async () => {
    const result = await importFromUrl(42);
    assert.deepEqual(result, { url: 42, success: false, error: "Invalid URL" });
  });

  it("rejects a string that is not a url", async () => {
    const result = await importFromUrl("not a url");
    assert.equal(result.error, "Invalid URL");
  });

  it("rejects a domain that is not whitelisted", async () => {
    const result = await importFromUrl("https://evil.test/a.gif");
    assert.equal(result.error, "Domain not whitelisted");
  });

  it("does not touch the network for a rejected domain", async () => {
    mediaExec.run = async () => {
      throw new Error("exec should not run");
    };
    importNet.fetch = async () => {
      throw new Error("fetch should not run");
    };
    const result = await importFromUrl("https://evil.test/a.gif");
    assert.equal(result.success, false);
    assert.equal(result.error, "Domain not whitelisted");
  });
});

describe("importFromUrl via gallery-dl", () => {
  it("stores a downloaded webp and records it in the database", async () => {
    const fake = fakeExec();
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/happy");

    assert.equal(result.success, true);
    assert.ok(result.slug);
    assert.match(result.filename ?? "", /\.webp$/);
    assert.ok(fs.existsSync(path.join(uploadDir, result.filename ?? "")));

    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.mimeType, "image/webp");
    assert.equal(row?.originalName, "download.webp");
  });

  it("removes the working directory once the import finishes", async () => {
    const fake = fakeExec();
    mediaExec.run = fake.run;

    await importFromUrl("https://tenor.com/view/happy");

    const call = fake.calls.find((entry) => entry.file === "gallery-dl");
    const tempDir = call?.args[call.args.indexOf("--directory") + 1] ?? "";
    assert.match(tempDir, /gifselector-import-/);
    assert.equal(fs.existsSync(tempDir), false);
  });

  it("imports an untrusted domain only when trusted is set", async () => {
    const fake = fakeExec();
    mediaExec.run = fake.run;

    const blocked = await importFromUrl("https://cdn.example.test/a.webp");
    assert.equal(blocked.error, "Domain not whitelisted");

    const allowed = await importFromUrl("https://cdn.example.test/a.webp", { trusted: true });
    assert.equal(allowed.success, true);
  });

  it("sanitizes a file it did not re-encode", async () => {
    const fake = fakeExec();
    mediaExec.run = fake.run;

    await importFromUrl("https://tenor.com/view/happy");

    const sanitized = fake.calls.some(
      (entry) =>
        (entry.file === "magick" || entry.file === "convert") &&
        entry.args.some((arg) => arg.includes("-clean-")),
    );
    assert.equal(sanitized, true);
  });

  it("converts a gif to webp before storing it", async () => {
    const fake = fakeExec({
      galleryDl: (dir) => fs.writeFileSync(path.join(dir, "download.gif"), gifBytes()),
    });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://giphy.com/gifs/x");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.webp$/);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.mimeType, "image/webp");
    assert.equal(row?.originalName, "download.gif");
  });

  it("renames a file whose extension lies about its bytes", async () => {
    const fake = fakeExec({
      galleryDl: (dir) => fs.writeFileSync(path.join(dir, "download.jpeg"), webpBytes()),
    });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.webp$/);
  });

  it("skips files that are not media and reports the failure", async () => {
    const fake = fakeExec({
      galleryDl: (dir) => fs.writeFileSync(path.join(dir, "readme.txt"), "not media at all"),
    });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /not valid GIFs\/WebPs/);
  });

  it("skips a file larger than the configured cap", async () => {
    const fake = fakeExec({
      galleryDl: (dir) =>
        fs.writeFileSync(
          path.join(dir, "huge.webp"),
          Buffer.concat([webpBytes(), Buffer.alloc(80_000)]),
        ),
    });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /not valid GIFs\/WebPs/);
    assert.deepEqual(fs.readdirSync(uploadDir), []);
  });

  it("rejects a file that busts the pixel budget", async () => {
    const fake = fakeExec({ geometry: "9000 9000\n" });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, false);
    assert.ok(warnings.some((line) => line.includes("megapixel budget")));
  });

  it("moves on to the next file when the first one is unusable", async () => {
    const fake = fakeExec({
      galleryDl: (dir) => {
        fs.mkdirSync(path.join(dir, "nested"));
        fs.writeFileSync(path.join(dir, "nested", "a.txt"), "junk");
        fs.writeFileSync(path.join(dir, "nested", "b.webp"), webpBytes());
      },
    });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, true);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.originalName, "b.webp");
  });

  it("reports an empty download directory", async () => {
    const fake = fakeExec({ galleryDl: () => {} });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.error, "No files downloaded by gallery-dl");
  });
});

describe("importFromUrl transcoding", () => {
  function mp4Download(dir: string): void {
    fs.writeFileSync(path.join(dir, "clip.mp4"), mp4Bytes());
  }

  it("turns an mp4 into a webp with ffmpeg", async () => {
    const fake = fakeExec({ galleryDl: mp4Download });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.webp$/);
    assert.ok(fake.calls.some((entry) => entry.file === "ffmpeg"));
  });

  it("falls back to imagemagick when ffmpeg cannot encode webp", async () => {
    const fake = fakeExec({ galleryDl: mp4Download, ffmpeg: false });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.webp$/);
    assert.ok(warnings.some((line) => line.includes("ffmpeg conversion failed")));
  });

  it("falls back to an mp4 to gif conversion when webp encoding is unavailable", async () => {
    const fake = fakeExec({ galleryDl: mp4Download, magick: false });
    mediaExec.run = async (file, args, options) => {
      if (file === "ffmpeg" && args[args.length - 1].endsWith(".webp")) {
        throw new Error("libwebp missing");
      }
      return fake.run(file, args, options);
    };

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.gif$/);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.mimeType, "image/gif");
  });

  it("gives up on an mp4 that cannot be converted at all", async () => {
    const fake = fakeExec({ galleryDl: mp4Download, ffmpeg: false, magick: false });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /not valid GIFs\/WebPs/);
  });

  it("animates a still image and stores it as a gif", async () => {
    const fake = fakeExec({ frames: 1 });
    mediaExec.run = fake.run;

    const result = await importFromUrl("https://tenor.com/view/still");

    assert.equal(result.success, true);
    assert.match(result.filename ?? "", /\.gif$/);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.mimeType, "image/gif");
  });

  it("keeps the file untouched when it is already animated", async () => {
    const fake = fakeExec({ frames: 4 });
    mediaExec.run = fake.run;
    const filePath = path.join(storageDir, "already-animated.gif");
    fs.writeFileSync(filePath, gifBytes());

    assert.equal(await ensureAnimated(filePath), null);
  });

  it("reports a failed animation pass without losing the original", async () => {
    const fake = fakeExec({ frames: 1, magick: false });
    mediaExec.run = fake.run;
    const filePath = path.join(storageDir, "still.gif");
    fs.writeFileSync(filePath, gifBytes());

    assert.equal(await ensureAnimated(filePath), null);
    assert.equal(fs.existsSync(filePath), true);
  });
});

describe("importFromUrl fallback fetch", () => {
  it("downloads the media directly when gallery-dl fails", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    const seen = stubFetch([mediaResponse(gifBytes(), "image/gif")]);

    const result = await importFromUrl("https://tenor.com/view/direct.gif");

    assert.equal(result.success, true);
    assert.deepEqual(seen, ["https://tenor.com/view/direct.gif"]);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.originalName, "fallback-download.gif");
  });

  it("names the download from the content type when the url has no extension", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([mediaResponse(webpBytes(), "image/webp")]);

    const result = await importFromUrl("https://tenor.com/view/nameless");

    assert.equal(result.success, true);
    const row = await findGifBySlug(result.slug ?? "");
    assert.equal(row?.originalName, "fallback-download.webp");
  });

  it("refuses a body whose advertised length exceeds the cap", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([mediaResponse(gifBytes(), "image/gif", { "content-length": "900000" })]);

    const result = await importFromUrl("https://tenor.com/view/big.gif");

    assert.match(result.error ?? "", /exceeds the 0\.05 MB limit/);
  });

  it("refuses a body that streams past the cap", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([mediaResponse(Buffer.concat([gifBytes(), Buffer.alloc(80_000)]), "image/gif")]);

    const result = await importFromUrl("https://tenor.com/view/big.gif");

    assert.match(result.error ?? "", /exceeds the 0\.05 MB limit/);
  });

  it("refuses a direct download that is not media", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([mediaResponse(Buffer.from("<svg/>"), "image/svg+xml")]);

    const result = await importFromUrl("https://tenor.com/view/x.svg");

    assert.equal(result.error, "Downloaded data is not a GIF, WebP or MP4 file");
  });

  it("surfaces a failed fallback fetch", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    importNet.fetch = async () => new Response("nope", { status: 503, statusText: "Unavailable" });

    const result = await importFromUrl("https://tenor.com/view/x");

    assert.match(result.error ?? "", /Fallback fetch failed: 503/);
  });
});

describe("importFromUrl metadata fallback", () => {
  it("follows an og:video url found in the page", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    const seen = stubFetch([
      htmlResponse(
        '<meta property="og:video" content="https://media.tenor.com/clip.mp4?a=1&amp;b=2">',
      ),
      mediaResponse(mp4Bytes(), "video/mp4"),
    ]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.equal(result.success, true);
    assert.equal(seen[1], "https://media.tenor.com/clip.mp4?a=1&b=2");
    assert.match(result.filename ?? "", /\.webp$/);
  });

  it("resolves a relative og:image against the page url", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    const seen = stubFetch([
      htmlResponse('<meta property="og:image" content="/assets/a.gif">'),
      mediaResponse(gifBytes(), "image/gif"),
    ]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.equal(result.success, true);
    assert.equal(seen[1], "https://tenor.com/assets/a.gif");
  });

  it("falls back to twitter:image when no og tags are present", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    const seen = stubFetch([
      htmlResponse('<meta name="twitter:image" content="https://media.tenor.com/t.gif">'),
      mediaResponse(gifBytes(), "image/gif"),
    ]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.equal(result.success, true);
    assert.equal(seen[1], "https://media.tenor.com/t.gif");
  });

  it("refuses metadata pointing at a domain that is not whitelisted", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([htmlResponse('<meta property="og:image" content="https://evil.test/a.gif">')]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.equal(result.error, "Media URL domain not whitelisted");
  });

  it("allows metadata on any domain for a trusted import", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    const seen = stubFetch([
      htmlResponse('<meta property="og:image" content="https://cdn.example.test/a.gif">'),
      mediaResponse(gifBytes(), "image/gif"),
    ]);

    const result = await importFromUrl("https://tenor.com/view/meta", { trusted: true });

    assert.equal(result.success, true);
    assert.equal(seen[1], "https://cdn.example.test/a.gif");
  });

  it("reports a page with no usable metadata", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([htmlResponse("<html><head><title>nothing</title></head></html>")]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.equal(result.error, "No media found via metadata fallback");
  });

  it("surfaces a failed media download", async () => {
    mediaExec.run = fakeExec({ galleryDl: false }).run;
    stubFetch([
      htmlResponse('<meta property="og:image" content="https://media.tenor.com/a.gif">'),
      new Response("nope", { status: 404 }),
    ]);

    const result = await importFromUrl("https://tenor.com/view/meta");

    assert.match(result.error ?? "", /Fallback download failed: 404/);
  });
});
