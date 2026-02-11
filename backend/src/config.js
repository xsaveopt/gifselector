const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

function normalizeBasePath(input) {
  if (!input) {
    return "/gifselector";
  }
  if (!input.startsWith("/")) {
    input = `/${input}`;
  }
  if (input.length > 1 && input.endsWith("/")) {
    input = input.slice(0, -1);
  }
  return input;
}

const BASE_PATH = normalizeBasePath(process.env.BACKEND_BASE_PATH);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || "5", 10);
const LOCKOUT_DURATION_MS = parseInt(
  process.env.LOCKOUT_DURATION_MS || "300000",
  10,
); // 5 minutes

const PUBLIC_GIF_CATEGORY = process.env.PUBLIC_GIF_CATEGORY;
const PUBLIC_API_SPEED_LIMIT = 1024 * 1024; // 1MB/s

function ensureAbsolutePath(label, targetPath) {
  if (!targetPath) {
    throw new Error(`${label} must be provided as an absolute path.`);
  }
  if (!path.isAbsolute(targetPath)) {
    throw new Error(
      `${label} must be an absolute path. Received: ${targetPath}`,
    );
  }
  return targetPath;
}

const defaultUploadDir =
  process.env.NODE_ENV === "production"
    ? "/app/backend/uploads"
    : path.join(process.cwd(), "uploads");

const resolvedUploadDir = ensureAbsolutePath(
  "UPLOAD_DIR",
  process.env.UPLOAD_DIR || defaultUploadDir,
);

if (!fs.existsSync(resolvedUploadDir)) {
  fs.mkdirSync(resolvedUploadDir, { recursive: true });
}

const defaultDataDir = path.join(__dirname, "..", "data");
const resolvedDataDir = ensureAbsolutePath(
  "DATA_DIR",
  process.env.DATA_DIR || defaultDataDir,
);

if (!fs.existsSync(resolvedDataDir)) {
  fs.mkdirSync(resolvedDataDir, { recursive: true });
}

const defaultFrontendDist =
  process.env.NODE_ENV === "production"
    ? "/app/frontend/dist"
    : path.join(process.cwd(), "..", "frontend", "dist");

const FRONTEND_DIST = ensureAbsolutePath(
  "FRONTEND_DIST",
  process.env.FRONTEND_DIST || defaultFrontendDist,
);

module.exports = {
  BASE_PATH,
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PUBLIC_GIF_CATEGORY,
  PUBLIC_API_SPEED_LIMIT,
  FRONTEND_DIST,
  UPLOAD_DIR: resolvedUploadDir,
  DATA_DIR: resolvedDataDir,
  ENABLE_FILE_LOGGING: process.env.ENABLE_FILE_LOGGING === "1",
  LOG_FILE_PATH: path.join(resolvedDataDir, "access.log"),
  STATS_FILE_PATH: path.join(resolvedDataDir, "log_statistics.txt"),
};
