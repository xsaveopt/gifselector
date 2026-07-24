import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface TempEnvOptions {
  frontend?: boolean;
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
