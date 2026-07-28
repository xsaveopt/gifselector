import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { declaredSizeGif, tempEnv } from "./helpers.ts";
import {
  detectMediaKind,
  detectFileMediaKind,
  assertValidImage,
  assertWithinPixelBudget,
  probeGeometry,
  sanitizeInPlace,
} from "../../src/server/media-guard.ts";

const dir = tempEnv();

function write(name: string, bytes: Buffer): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function gifBytes(): Buffer {
  return Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16)]);
}

function webpBytes(): Buffer {
  const header = Buffer.alloc(16);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(8, 4);
  header.write("WEBP", 8, "latin1");
  return header;
}

function mp4Bytes(): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16, 0);
  header.write("ftypisom", 4, "latin1");
  return header;
}

describe("detectMediaKind", () => {
  it("recognises gif, webp, and mp4 signatures", () => {
    assert.equal(detectMediaKind(gifBytes()), "gif");
    assert.equal(detectMediaKind(Buffer.from("GIF87a-----", "latin1")), "gif");
    assert.equal(detectMediaKind(webpBytes()), "webp");
    assert.equal(detectMediaKind(mp4Bytes()), "mp4");
  });

  it("rejects other content, including a png and an elf binary", () => {
    assert.equal(
      detectMediaKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      null,
    );
    assert.equal(
      detectMediaKind(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])),
      null,
    );
    assert.equal(detectMediaKind(Buffer.from("#!/bin/sh\necho hi\n", "latin1")), null);
  });

  it("rejects a riff container that is not webp", () => {
    const wav = Buffer.alloc(16);
    wav.write("RIFF", 0, "latin1");
    wav.write("WAVE", 8, "latin1");
    assert.equal(detectMediaKind(wav), null);
  });

  it("rejects a buffer too short to identify", () => {
    assert.equal(detectMediaKind(Buffer.from("GIF", "latin1")), null);
    assert.equal(detectMediaKind(Buffer.alloc(0)), null);
  });
});

describe("detectFileMediaKind", () => {
  it("reads the signature from disk", async () => {
    assert.equal(await detectFileMediaKind(write("real.gif", gifBytes())), "gif");
    assert.equal(await detectFileMediaKind(write("real.webp", webpBytes())), "webp");
  });

  it("ignores a misleading extension", async () => {
    const disguised = write("payload.gif", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
    assert.equal(await detectFileMediaKind(disguised), null);
  });
});

const hasMagick = await (async () => {
  try {
    await promisify(execFile)("magick", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

async function makeGif(name: string, size: string): Promise<string> {
  const filePath = path.join(dir, name);
  await promisify(execFile)("magick", [
    "-size",
    size,
    "xc:red",
    "xc:blue",
    "-delay",
    "10",
    filePath,
  ]);
  return filePath;
}

describe("assertWithinPixelBudget", { skip: !hasMagick }, () => {
  it("rejects a tiny file that declares an enormous canvas", async () => {
    const bomb = write("bomb.gif", declaredSizeGif(20000, 20000));
    assert.ok(fs.statSync(bomb).size < 100);
    await assert.rejects(() => assertWithinPixelBudget(bomb, "gif"), /megapixel budget/);
  });

  it("accepts an ordinary animation", async () => {
    const ok = await makeGif("fine.gif", "200x200");
    await assertWithinPixelBudget(ok, "gif");
  });
});

describe("sanitizeInPlace", { skip: !hasMagick }, () => {
  it("drops appended data and embedded metadata", async () => {
    const source = await makeGif("dirty-source.gif", "32x32");
    const filePath = path.join(dir, "dirty.gif");
    await promisify(execFile)("magick", [
      source,
      "-set",
      "comment",
      "SECRET_METADATA_PAYLOAD",
      filePath,
    ]);
    fs.appendFileSync(filePath, "\n<script>alert(1)</script>");

    const before = fs.readFileSync(filePath);
    assert.ok(before.includes(Buffer.from("SECRET_METADATA_PAYLOAD")));
    assert.ok(before.includes(Buffer.from("<script>")));

    await sanitizeInPlace(filePath, "gif");

    const after = fs.readFileSync(filePath);
    assert.ok(!after.includes(Buffer.from("SECRET_METADATA_PAYLOAD")));
    assert.ok(!after.includes(Buffer.from("<script>")));
    assert.equal(await detectFileMediaKind(filePath), "gif");
  });

  it("keeps the animation intact", async () => {
    const filePath = await makeGif("animated.gif", "32x32");
    await sanitizeInPlace(filePath, "gif");
    const geometry = await probeGeometry(filePath, "gif");
    assert.equal(geometry?.frames, 2);
  });
});

describe("assertValidImage", () => {
  it("rejects a file whose bytes are not an accepted image", async () => {
    const disguised = write("fake.gif", Buffer.from("not an image at all really", "latin1"));
    await assert.rejects(
      () => assertValidImage(disguised, ["gif", "webp"]),
      /not a valid GIF or WebP/,
    );
  });

  it("rejects an mp4 when only images are expected", async () => {
    const video = write("clip.mp4", mp4Bytes());
    await assert.rejects(() => assertValidImage(video, ["gif", "webp"]), /not a valid GIF or WebP/);
  });
});
