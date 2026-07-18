import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

execSync("pnpm --filter=./frontend build", { cwd: root, stdio: "inherit" });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gifselector-e2e-"));

process.env.PORT = process.env.E2E_PORT ?? "3200";
process.env.BACKEND_BASE_PATH = "/gifselector";
process.env.DATA_DIR = path.join(tmp, "data");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.FRONTEND_DIST = path.join(root, "frontend", "dist");
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "e2e-password";
process.env.JWT_SECRET = "e2e-secret";

await import(path.join(root, "backend", "src", "server.ts"));
