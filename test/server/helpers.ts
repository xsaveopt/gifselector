import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface TempEnvOptions {
  frontend?: boolean;
}

export function declaredSizeGif(width: number, height: number): Buffer {
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0xf0;
  const descriptor = Buffer.alloc(10);
  descriptor[0] = 0x2c;
  descriptor.writeUInt16LE(width, 5);
  descriptor.writeUInt16LE(height, 7);
  return Buffer.concat([
    Buffer.from("GIF89a", "latin1"),
    lsd,
    Buffer.from([0, 0, 0, 255, 255, 255]),
    descriptor,
    Buffer.from([0x02, 0x01, 0x2c, 0x00, 0x3b]),
  ]);
}

export function gifBytes(): Buffer {
  return Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16)]);
}

export function webpBytes(): Buffer {
  const header = Buffer.alloc(16);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(8, 4);
  header.write("WEBP", 8, "latin1");
  return header;
}

export function mp4Bytes(): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16, 0);
  header.write("ftypisom", 4, "latin1");
  return header;
}

export function bytesForExtension(ext: string): Buffer {
  if (ext === ".webp") {
    return webpBytes();
  }
  if (ext === ".mp4") {
    return mp4Bytes();
  }
  return gifBytes();
}

export interface FakeExecCall {
  file: string;
  args: string[];
}

export interface FakeExecOptions {
  galleryDl?: ((dir: string, url: string) => void) | false;
  magick?: boolean;
  ffmpeg?: boolean;
  frames?: number;
  geometry?: string;
}

export interface FakeExec {
  calls: FakeExecCall[];
  run: (
    file: string,
    args: string[],
    options: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
}

function outputPath(args: string[]): string {
  const last = args[args.length - 1];
  const colon = last.indexOf(":");
  return colon === -1 ? last : last.slice(colon + 1);
}

function writeOutput(target: string): void {
  fs.writeFileSync(target, bytesForExtension(path.extname(target).toLowerCase()));
}

export function fakeExec(options: FakeExecOptions = {}): FakeExec {
  const calls: FakeExecCall[] = [];
  const empty = { stdout: "", stderr: "" };

  const run = async (file: string, args: string[]) => {
    calls.push({ file, args });

    if (file === "gallery-dl") {
      if (options.galleryDl === false) {
        throw new Error("gallery-dl exited with code 1");
      }
      const dir = args[args.indexOf("--directory") + 1];
      const url = args[args.length - 1];
      if (options.galleryDl) {
        options.galleryDl(dir, url);
      } else {
        fs.writeFileSync(path.join(dir, "download.webp"), webpBytes());
      }
      return empty;
    }

    if (file === "ffmpeg") {
      if (options.ffmpeg === false) {
        throw new Error("ffmpeg exited with code 1");
      }
      writeOutput(outputPath(args));
      return empty;
    }

    if (file === "magick" || file === "convert" || file === "identify") {
      const identify = file === "identify" || args[0] === "identify";
      if (identify) {
        if (args.includes("%n\n")) {
          return { stdout: `${options.frames ?? 2}\n`, stderr: "" };
        }
        if (args.includes("%w %h\n")) {
          return { stdout: options.geometry ?? "100 100\n", stderr: "" };
        }
        return empty;
      }
      if (options.magick === false) {
        throw new Error("magick exited with code 1");
      }
      writeOutput(outputPath(args));
      return empty;
    }

    const error = new Error(`spawn ${file} ENOENT`) as Error & { code: string };
    error.code = "ENOENT";
    throw error;
  };

  return { calls, run };
}

export function tempEnv(options: TempEnvOptions = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gifselector-test-"));
  const uploadDir = path.join(dir, "uploads");
  const distDir = path.join(dir, "dist");
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  process.env.TEST_STORAGE_DIR = dir;
  process.env.TEST_FRONTEND_DIST = distDir;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.JWT_SECRET = "test-secret";

  if (options.frontend) {
    fs.writeFileSync(
      path.join(distDir, "index.html"),
      '<!doctype html><html><head><title>gifselector</title></head><body><div id="root"></div></body></html>',
    );
  }

  return dir;
}
