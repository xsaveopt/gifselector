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
