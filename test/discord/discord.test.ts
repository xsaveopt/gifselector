import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Message, OmitPartialGroupDMChannel } from "discord.js";
import { fakeExec, tempEnv } from "../server/helpers.ts";

tempEnv();
process.env.DISCORD_PUBLIC_ORIGIN = "https://gifs.example.com/";
process.env.BASE_PATH = "/gifselector";
process.env.DISCORD_ALLOWED_USER_IDS = "user-1";
process.env.DISCORD_CHANNEL_IDS = "chan-1";
process.env.DISCORD_RATE_LIMIT_MAX = "3";

const { mediaExec } = await import("../../src/server/media-guard.ts");
const { importNet } = await import("../../src/server/importer.ts");
const {
  extractContentUrls,
  extractAttachmentUrls,
  handleMessage,
  importQuota,
  isAuthorAllowed,
  isChannelAllowed,
  buildShareUrl,
  startDiscordBot,
  stopDiscordBot,
} = await import("../../src/discord/discord.ts");

interface FakeAttachment {
  url: string;
  contentType: string | null;
  name: string | null;
}

interface FakeMessageOptions {
  authorId?: string;
  bot?: boolean;
  channelId?: string;
  content?: string;
  attachments?: FakeAttachment[];
  replyFails?: boolean;
}

function fakeMessage(options: FakeMessageOptions = {}) {
  const replies: string[] = [];
  const reactions: string[] = [];
  const message = {
    author: { id: options.authorId ?? "user-1", bot: options.bot ?? false },
    channelId: options.channelId ?? "chan-1",
    content: options.content ?? "",
    attachments: new Map(
      (options.attachments ?? []).map((attachment, index) => [String(index), attachment]),
    ),
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async ({ content }: { content: string }) => {
      if (options.replyFails) {
        throw new Error("Missing Permissions");
      }
      replies.push(content);
    },
  };
  return {
    replies,
    reactions,
    message: message as unknown as OmitPartialGroupDMChannel<Message>,
  };
}

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

describe("handleMessage", () => {
  beforeEach(() => {
    importQuota.reset();
    mediaExec.run = fakeExec().run;
    importNet.fetch = async () => {
      throw new Error("the fallback fetch should not run in these tests");
    };
  });

  it("ignores messages from bots", async () => {
    const { message, replies, reactions } = fakeMessage({
      bot: true,
      content: "https://tenor.com/view/x",
    });
    await handleMessage(message);
    assert.deepEqual(replies, []);
    assert.deepEqual(reactions, []);
  });

  it("ignores authors that are not on the allow list", async () => {
    const { message, replies } = fakeMessage({
      authorId: "stranger",
      content: "https://tenor.com/view/x",
    });
    await handleMessage(message);
    assert.deepEqual(replies, []);
  });

  it("ignores channels that are not on the allow list", async () => {
    const { message, replies } = fakeMessage({
      channelId: "chan-9",
      content: "https://tenor.com/view/x",
    });
    await handleMessage(message);
    assert.deepEqual(replies, []);
  });

  it("ignores a message with no urls at all", async () => {
    const { message, replies, reactions } = fakeMessage({ content: "nice gif" });
    await handleMessage(message);
    assert.deepEqual(replies, []);
    assert.deepEqual(reactions, []);
  });

  it("uploads an attachment and replies with its share link", async () => {
    const { message, replies, reactions } = fakeMessage({
      attachments: [
        {
          url: "https://cdn.discordapp.com/attachments/1/2/a.gif",
          contentType: "image/gif",
          name: "a.gif",
        },
      ],
    });

    await handleMessage(message);

    assert.deepEqual(reactions, ["⏳"]);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /^✅ https:\/\/gifs\.example\.com\/gifselector\/share\/[\w-]+\.webp$/);
  });

  it("imports a link from the message body", async () => {
    const { message, replies } = fakeMessage({ content: "look https://tenor.com/view/x" });
    await handleMessage(message);
    assert.match(replies[0], /^✅ https:\/\/gifs\.example\.com\/gifselector\/share\//);
  });

  it("reports a link it is not allowed to fetch", async () => {
    const { message, replies } = fakeMessage({ content: "https://evil.test/a.gif" });
    await handleMessage(message);
    assert.equal(replies[0], "❌ <https://evil.test/a.gif> failed: Domain not whitelisted");
  });

  it("reports a failed attachment upload", async () => {
    mediaExec.run = fakeExec({ galleryDl: () => {} }).run;
    const { message, replies } = fakeMessage({
      attachments: [
        {
          url: "https://cdn.discordapp.com/attachments/1/2/a.gif",
          contentType: "image/gif",
          name: "a.gif",
        },
      ],
    });

    await handleMessage(message);

    assert.equal(replies[0], "❌ attachment failed: No files downloaded by gallery-dl");
  });

  it("does not import an attachment url twice when it is also in the body", async () => {
    const url = "https://cdn.discordapp.com/attachments/1/2/a.gif";
    const { message, replies } = fakeMessage({
      content: `here ${url}`,
      attachments: [{ url, contentType: "image/gif", name: "a.gif" }],
    });

    await handleMessage(message);

    assert.equal(replies[0].split("\n").length, 1);
  });

  it("stops at the quota and says how many were skipped", async () => {
    const { message, replies } = fakeMessage({
      content: [
        "https://tenor.com/view/1",
        "https://tenor.com/view/2",
        "https://tenor.com/view/3",
        "https://tenor.com/view/4",
      ].join(" "),
    });

    await handleMessage(message);

    const lines = replies[0].split("\n");
    assert.equal(lines.length, 4);
    assert.equal(lines.filter((line) => line.startsWith("✅")).length, 3);
    assert.match(lines[3], /^⏱️ 1 skipped: rate limit of 3 gifs per 10m/);
  });

  it("answers with the rate limit notice once the quota is spent", async () => {
    importQuota.take("user-1", 3);
    const { message, replies, reactions } = fakeMessage({
      content: "https://tenor.com/view/x",
    });

    await handleMessage(message);

    assert.deepEqual(reactions, []);
    assert.match(replies[0], /^⏱️ Rate limit reached: 3 gifs per 10m\. Try again in \d+m\./);
  });

  it("survives a reply it is not allowed to post", async () => {
    const { message, replies } = fakeMessage({
      content: "https://tenor.com/view/x",
      replyFails: true,
    });

    await handleMessage(message);

    assert.deepEqual(replies, []);
  });
});

describe("startDiscordBot", () => {
  it("stays offline when no bot token is configured", async () => {
    startDiscordBot();
    await stopDiscordBot();
  });
});
