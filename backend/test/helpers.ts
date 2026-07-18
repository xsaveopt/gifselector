import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface TempEnvOptions {
  frontend?: boolean;
}

export function tempEnv(options: TempEnvOptions = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gifselector-test-"));
  const dataDir = path.join(dir, "data");
  const uploadDir = path.join(dir, "uploads");
  const distDir = path.join(dir, "dist");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  process.env.DATA_DIR = dataDir;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.FRONTEND_DIST = distDir;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.JWT_SECRET = "test-secret";

  if (options.frontend) {
    fs.writeFileSync(
      path.join(distDir, "index.html"),
      '<!doctype html><title>gifselector</title><div id="root"></div>',
    );
  }

  return dir;
}
