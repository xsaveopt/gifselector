import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { declaredSizeGif, enoent, tempEnv } from "./helpers.ts";
import {
  MAGICK_LIMITS,
  mediaExec,
  pinnedInput,
  probeDecodable,
  runMagick,
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

type ExecCall = { file: string; args: string[] };
type ExecReply = { stdout?: string; error?: Error };

async function withFakeExec(
  replies: Record<string, ExecReply>,
  body: (calls: ExecCall[]) => Promise<void>,
): Promise<void> {
  const calls: ExecCall[] = [];
  const realRun = mediaExec.run;
  mediaExec.run = async (file, args) => {
    calls.push({ file, args });
    const reply = replies[file];
    if (!reply) {
      throw enoent(file);
    }
    if (reply.error) {
      throw reply.error;
    }
    return { stdout: reply.stdout ?? "", stderr: "" };
  };
  try {
    await body(calls);
  } finally {
    mediaExec.run = realRun;
  }
}

describe("runMagick with a fake exec", () => {
  it("prefixes the resource limits and stops after magick succeeds", async () => {
    await withFakeExec({ magick: {} }, async (calls) => {
      await runMagick(["in.gif", "out.gif"]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].file, "magick");
      assert.deepEqual(calls[0].args, [...MAGICK_LIMITS, "in.gif", "out.gif"]);
    });
  });

  it("falls back to convert when magick is not installed", async () => {
    await withFakeExec({ convert: {} }, async (calls) => {
      await runMagick(["in.gif", "out.gif"]);
      assert.deepEqual(
        calls.map((call) => call.file),
        ["magick", "convert"],
      );
      assert.deepEqual(calls[1].args, [...MAGICK_LIMITS, "in.gif", "out.gif"]);
    });
  });

  it("retries with convert when magick fails for another reason", async () => {
    await withFakeExec(
      { magick: { error: new Error("magick exited with code 1") }, convert: {} },
      async (calls) => {
        await runMagick(["in.gif", "out.gif"]);
        assert.deepEqual(
          calls.map((call) => call.file),
          ["magick", "convert"],
        );
      },
    );
  });

  it("reports that imagemagick is missing when neither binary exists", async () => {
    await withFakeExec({}, async () => {
      await assert.rejects(() => runMagick(["in.gif", "out.gif"]), /ImageMagick is not available/);
    });
  });

  it("surfaces the magick failure when convert is not installed", async () => {
    await withFakeExec({ magick: { error: new Error("magick exited with code 1") } }, async () => {
      await assert.rejects(() => runMagick(["in.gif", "out.gif"]), /magick exited with code 1/);
    });
  });

  it("surfaces the convert failure when both binaries fail", async () => {
    await withFakeExec(
      {
        magick: { error: new Error("magick exited with code 1") },
        convert: { error: new Error("convert exited with code 1") },
      },
      async () => {
        await assert.rejects(() => runMagick(["in.gif", "out.gif"]), /convert exited with code 1/);
      },
    );
  });
});

describe("probeDecodable with a fake exec", () => {
  it("accepts a file magick can identify", async () => {
    await withFakeExec({ magick: {} }, async (calls) => {
      assert.equal(await probeDecodable("clip.gif"), true);
      assert.deepEqual(calls, [{ file: "magick", args: ["identify", "clip.gif"] }]);
    });
  });

  it("falls back to identify when magick is not installed", async () => {
    await withFakeExec({ identify: {} }, async (calls) => {
      assert.equal(await probeDecodable("clip.gif"), true);
      assert.deepEqual(calls[1], { file: "identify", args: ["clip.gif"] });
    });
  });

  it("rejects a file magick fails to identify without trying identify", async () => {
    await withFakeExec(
      { magick: { error: new Error("identify: corrupt image") }, identify: {} },
      async (calls) => {
        assert.equal(await probeDecodable("clip.gif"), false);
        assert.equal(calls.length, 1);
      },
    );
  });

  it("rejects a file the identify fallback fails on", async () => {
    await withFakeExec({ identify: { error: new Error("identify: corrupt image") } }, async () => {
      assert.equal(await probeDecodable("clip.gif"), false);
    });
  });

  it("lets the file through when no imagemagick binary is installed", async () => {
    await withFakeExec({}, async (calls) => {
      assert.equal(await probeDecodable("clip.gif"), true);
      assert.equal(calls.length, 2);
    });
  });
});

describe("probeGeometry with a fake exec", () => {
  it("pings the pinned coder through magick identify", async () => {
    await withFakeExec({ magick: { stdout: "10 20\n" } }, async (calls) => {
      await probeGeometry("clip.webp", "webp");
      assert.deepEqual(calls[0].args, [
        "identify",
        "-ping",
        "-format",
        "%w %h\n",
        pinnedInput("clip.webp", "webp"),
      ]);
      assert.equal(pinnedInput("clip.webp", "webp"), "WEBP:clip.webp");
    });
  });

  it("sums the pixels of every frame", async () => {
    await withFakeExec({ magick: { stdout: "100 50\n200 10\n30 30\n" } }, async () => {
      assert.deepEqual(await probeGeometry("clip.gif", "gif"), {
        frames: 3,
        totalPixels: 100 * 50 + 200 * 10 + 30 * 30,
      });
    });
  });

  it("skips lines that are not a width and height", async () => {
    await withFakeExec({ magick: { stdout: "garbage\n40 40\n12\n" } }, async () => {
      assert.deepEqual(await probeGeometry("clip.gif", "gif"), { frames: 1, totalPixels: 1600 });
    });
  });

  it("returns null when no frame could be read", async () => {
    await withFakeExec({ magick: { stdout: "" } }, async () => {
      assert.equal(await probeGeometry("clip.gif", "gif"), null);
    });
  });

  it("falls back to identify without the subcommand", async () => {
    await withFakeExec({ identify: { stdout: "8 8\n" } }, async (calls) => {
      assert.deepEqual(await probeGeometry("clip.gif", "gif"), { frames: 1, totalPixels: 64 });
      assert.equal(calls[1].file, "identify");
      assert.deepEqual(calls[1].args, ["-ping", "-format", "%w %h\n", "GIF:clip.gif"]);
    });
  });

  it("returns null when magick fails", async () => {
    await withFakeExec(
      { magick: { error: new Error("boom") }, identify: { stdout: "8 8\n" } },
      async (calls) => {
        assert.equal(await probeGeometry("clip.gif", "gif"), null);
        assert.equal(calls.length, 1);
      },
    );
  });

  it("returns null when no imagemagick binary is installed", async () => {
    await withFakeExec({}, async () => {
      assert.equal(await probeGeometry("clip.gif", "gif"), null);
    });
  });
});

describe("assertWithinPixelBudget with a fake exec", () => {
  it("rejects frames whose combined pixels exceed the budget", async () => {
    await withFakeExec({ magick: { stdout: "5000 5000\n5000 5000\n5000 5000\n" } }, async () => {
      await assert.rejects(
        () => assertWithinPixelBudget("clip.gif", "gif"),
        /megapixel budget \(75 MP across 3 frame\(s\)\)/,
      );
    });
  });

  it("accepts an animation right at the budget", async () => {
    await withFakeExec({ magick: { stdout: "5000 5000\n5000 5000\n" } }, async () => {
      await assertWithinPixelBudget("clip.gif", "gif");
    });
  });
});

describe("sanitizeInPlace with a fake exec", () => {
  it("refuses to sanitize an mp4", async () => {
    await withFakeExec({ magick: {} }, async (calls) => {
      await assert.rejects(() => sanitizeInPlace("clip.mp4", "mp4"), /cannot be sanitized/);
      assert.equal(calls.length, 0);
    });
  });

  it("leaves the original and no temp file behind when imagemagick fails", async () => {
    const filePath = write("unsanitized.gif", gifBytes());
    const before = fs.readdirSync(dir).sort();
    await withFakeExec({ magick: { error: new Error("magick exited with code 1") } }, async () => {
      await assert.rejects(() => sanitizeInPlace(filePath, "gif"), /magick exited/);
    });
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
    assert.deepEqual(fs.readFileSync(filePath), gifBytes());
  });

  it("fails when imagemagick exits cleanly without writing the output", async () => {
    const filePath = write("unwritten.gif", gifBytes());
    await withFakeExec({ magick: {} }, async (calls) => {
      await assert.rejects(() => sanitizeInPlace(filePath, "gif"), /ENOENT/);
      const target = calls[0].args[calls[0].args.length - 1];
      assert.match(target, /^GIF:.*unwritten-clean-[\w-]{6}\.gif$/);
    });
    assert.deepEqual(fs.readFileSync(filePath), gifBytes());
  });
});
