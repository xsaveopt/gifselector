import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tempEnv } from "../server/helpers.ts";

tempEnv();
process.env.DISCORD_PUBLIC_ORIGIN = "https://gifs.example.com/";
process.env.BASE_PATH = "/gifselector";
const {
  extractContentUrls,
  extractAttachmentUrls,
  isAuthorAllowed,
  isChannelAllowed,
  buildShareUrl,
} = await import("../../src/discord/discord.ts");

describe("extractContentUrls", () => {
  it("finds http and https urls in message content", () => {
    const urls = extractContentUrls("check https://tenor.com/view/abc and http://giphy.com/x out");
    assert.deepEqual(urls, ["https://tenor.com/view/abc", "http://giphy.com/x"]);
  });

  it("returns an empty array when there are no urls", () => {
    assert.deepEqual(extractContentUrls("just some text"), []);
  });

  it("stops urls at angle brackets and quotes", () => {
    assert.deepEqual(extractContentUrls("<https://tenor.com/view/abc>"), [
      "https://tenor.com/view/abc",
    ]);
  });
});

describe("extractAttachmentUrls", () => {
  it("accepts gif, webp, and mp4 attachments by content type", () => {
    const urls = extractAttachmentUrls([
      { url: "https://cdn.discordapp.com/a/1", contentType: "image/gif", name: "a" },
      { url: "https://cdn.discordapp.com/a/2", contentType: "video/mp4", name: "b" },
      { url: "https://cdn.discordapp.com/a/3", contentType: "image/png", name: "c.png" },
    ]);
    assert.deepEqual(urls, ["https://cdn.discordapp.com/a/1", "https://cdn.discordapp.com/a/2"]);
  });

  it("falls back to the filename extension when content type is missing", () => {
    const urls = extractAttachmentUrls([
      { url: "https://cdn.discordapp.com/a/1", contentType: null, name: "funny.webp" },
      { url: "https://cdn.discordapp.com/a/2", contentType: null, name: "doc.pdf" },
    ]);
    assert.deepEqual(urls, ["https://cdn.discordapp.com/a/1"]);
  });

  it("matches extensions with query strings on the url", () => {
    const urls = extractAttachmentUrls([
      { url: "https://cdn.discordapp.com/a/1/x.gif?ex=abc", contentType: null, name: null },
    ]);
    assert.deepEqual(urls, ["https://cdn.discordapp.com/a/1/x.gif?ex=abc"]);
  });
});

describe("isAuthorAllowed", () => {
  it("only allows listed user ids", () => {
    assert.equal(isAuthorAllowed("123", ["123", "456"]), true);
    assert.equal(isAuthorAllowed("789", ["123", "456"]), false);
  });

  it("denies everyone when the list is empty", () => {
    assert.equal(isAuthorAllowed("123", []), false);
  });
});

describe("isChannelAllowed", () => {
  it("allows any channel when no channel filter is configured", () => {
    assert.equal(isChannelAllowed("555", []), true);
  });

  it("restricts to listed channels when configured", () => {
    assert.equal(isChannelAllowed("555", ["555"]), true);
    assert.equal(isChannelAllowed("666", ["555"]), false);
  });
});

describe("buildShareUrl", () => {
  it("builds a share url from DISCORD_PUBLIC_ORIGIN, base path, slug, and extension", () => {
    assert.equal(
      buildShareUrl("abc123", "170000-x1.webp"),
      "https://gifs.example.com/gifselector/share/abc123.webp",
    );
  });

  it("defaults unknown extensions to gif", () => {
    assert.equal(
      buildShareUrl("abc123", "weird.bin"),
      "https://gifs.example.com/gifselector/share/abc123.gif",
    );
  });
});
