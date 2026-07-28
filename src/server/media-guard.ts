import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { execFile } from "node:child_process";
import { nanoid } from "nanoid";
import config from "./config.ts";

const fsPromises = fs.promises;
const execFilePromise = util.promisify(execFile);

export const SIGNATURE_HEADER_BYTES = 16;

export type MediaKind = "gif" | "webp" | "mp4";

export const MAGICK_LIMITS = [
  "-limit",
  "memory",
  "256MiB",
  "-limit",
  "map",
  "512MiB",
  "-limit",
  "disk",
  "1GiB",
  "-limit",
  "time",
  String(Math.ceil(config.MEDIA_TIMEOUT_MS / 1000)),
];

const MAGICK_CODER: Record<MediaKind, string> = {
  gif: "GIF",
  webp: "WEBP",
  mp4: "MP4",
};

export function pinnedInput(filePath: string, kind: MediaKind): string {
  return `${MAGICK_CODER[kind]}:${filePath}`;
}

export async function runMagick(args: string[]): Promise<void> {
  let lastError: unknown = new Error("ImageMagick is not available");
  for (const bin of ["magick", "convert"]) {
    try {
      await execFilePromise(bin, [...MAGICK_LIMITS, ...args], {
        timeout: config.MEDIA_TIMEOUT_MS,
      });
      return;
    } catch (err) {
      if ((err as { code?: unknown }).code === "ENOENT") {
        continue;
      }
      lastError = err;
      if (bin === "magick") {
        continue;
      }
    }
  }
  throw lastError;
}

export function detectMediaKind(header: Buffer): MediaKind | null {
  if (header.length >= 6) {
    const magic = header.subarray(0, 6).toString("latin1");
    if (magic === "GIF87a" || magic === "GIF89a") {
      return "gif";
    }
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString("latin1") === "RIFF" &&
    header.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (header.length >= 12 && header.subarray(4, 8).toString("latin1") === "ftyp") {
    return "mp4";
  }
  return null;
}

export async function detectFileMediaKind(filePath: string): Promise<MediaKind | null> {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(SIGNATURE_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_HEADER_BYTES, 0);
    return detectMediaKind(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function probeDecodable(filePath: string): Promise<boolean> {
  for (const [bin, args] of [
    ["magick", ["identify", filePath]],
    ["identify", [filePath]],
  ] as [string, string[]][]) {
    try {
      await execFilePromise(bin, args, { timeout: 30_000 });
      return true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "ENOENT") {
        continue;
      }
      return false;
    }
  }
  return true;
}

export async function assertValidImage(
  filePath: string,
  expected: MediaKind[],
): Promise<MediaKind> {
  const kind = await detectFileMediaKind(filePath);
  if (!kind || !expected.includes(kind)) {
    throw new Error("File is not a valid GIF or WebP image.");
  }
  if (!(await probeDecodable(filePath))) {
    throw new Error("File could not be decoded as an image.");
  }
  await assertWithinPixelBudget(filePath, kind);
  return kind;
}

export interface Geometry {
  frames: number;
  totalPixels: number;
}

export async function probeGeometry(filePath: string, kind: MediaKind): Promise<Geometry | null> {
  for (const bin of ["magick", "identify"]) {
    const args =
      bin === "magick"
        ? ["identify", "-ping", "-format", "%w %h\n", pinnedInput(filePath, kind)]
        : ["-ping", "-format", "%w %h\n", pinnedInput(filePath, kind)];
    try {
      const { stdout } = await execFilePromise(bin, args, { timeout: config.MEDIA_TIMEOUT_MS });
      let frames = 0;
      let totalPixels = 0;
      for (const line of stdout.trim().split("\n")) {
        const [width, height] = line.trim().split(/\s+/).map(Number);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          continue;
        }
        frames += 1;
        totalPixels += width * height;
      }
      return frames > 0 ? { frames, totalPixels } : null;
    } catch (err) {
      if ((err as { code?: unknown }).code === "ENOENT") {
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function assertWithinPixelBudget(filePath: string, kind: MediaKind): Promise<void> {
  const geometry = await probeGeometry(filePath, kind);
  if (!geometry) {
    return;
  }
  if (geometry.totalPixels > config.MAX_PIXELS) {
    throw new Error(
      `Image exceeds the ${config.MAX_MEGAPIXELS} megapixel budget (${Math.round(
        geometry.totalPixels / 1_000_000,
      )} MP across ${geometry.frames} frame(s)).`,
    );
  }
}

export async function sanitizeInPlace(filePath: string, kind: MediaKind): Promise<void> {
  if (kind === "mp4") {
    throw new Error("MP4 cannot be sanitized in place.");
  }
  const ext = path.extname(filePath);
  const tmpPath = `${filePath.slice(0, filePath.length - ext.length)}-clean-${nanoid(6)}${ext}`;
  try {
    await runMagick([
      pinnedInput(filePath, kind),
      "-coalesce",
      "-strip",
      `${MAGICK_CODER[kind]}:${tmpPath}`,
    ]);
    await fsPromises.access(tmpPath);
    await fsPromises.rename(tmpPath, filePath);
  } catch (err) {
    await fsPromises.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
