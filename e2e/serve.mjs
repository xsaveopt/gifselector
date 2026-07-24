import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

execSync("pnpm build", { cwd: root, stdio: "inherit" });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gifselector-e2e-"));

process.env.PORT = process.env.E2E_PORT ?? "3200";
process.env.BASE_PATH = "/gifselector";
process.env.TEST_STORAGE_DIR = tmp;
process.env.TEST_FRONTEND_DIST = path.join(root, "dist");
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "e2e-password";
process.env.JWT_SECRET = "e2e-secret";

await import(path.join(root, "src", "server", "server.ts"));
