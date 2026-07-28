import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import defaultAllowedImportDomains from "./valid-domains.ts";

dotenv.config();

function normalizeBasePath(input: string | undefined): string {
  let value = (input ?? "").trim();
  if (!value || value === "/") {
    return "";
  }
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }
  if (value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value;
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const MOUNT_PATH = BASE_PATH || "/";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const DEFAULT_JWT_SECRET = "dev-secret-change-me";
const DEFAULT_ADMIN_PASSWORD = "change-me";

const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

if (IS_PRODUCTION) {
  const insecure: string[] = [];
  if (JWT_SECRET === DEFAULT_JWT_SECRET) insecure.push("JWT_SECRET");
  if (ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) insecure.push("ADMIN_PASSWORD");
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start in production with default ${insecure.join(" and ")}. Set ${insecure.join(", ")} to strong value(s).`,
    );
  }
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) ? asNumber : value;
}

const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

const PUBLIC_CATEGORY = process.env.GIFS_PUBLIC_CATEGORY;
const PUBLIC_API_SPEED_LIMIT = 1024 * 1024;

function parsePublicOrigin(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`GIFS_PUBLIC_ORIGIN is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`GIFS_PUBLIC_ORIGIN must be http or https, got ${parsed.protocol}`);
  }
  return parsed.origin;
}

const PUBLIC_ORIGIN = parsePublicOrigin(process.env.GIFS_PUBLIC_ORIGIN);

const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_IMPORT_URLS = 20;

function parseDefaultCategoryId(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const DEFAULT_CATEGORY_ID = parseDefaultCategoryId(process.env.GIFS_DEFAULT_CATEGORY_ID);

function parseAllowedImportDomains(value: string | undefined): string[] {
  if (value === undefined) {
    return defaultAllowedImportDomains;
  }
  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : defaultAllowedImportDomains;
}

const ALLOWED_IMPORT_DOMAINS = parseAllowedImportDomains(process.env.GIFS_ALLOWED_DOMAINS);

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_FILE_SIZE_MB = parsePositiveNumber(process.env.GIFS_MAX_FILE_SIZE_MB, 15);
const MAX_FILE_SIZE_BYTES = Math.floor(MAX_FILE_SIZE_MB * 1024 * 1024);

const MAX_MEGAPIXELS = parsePositiveNumber(process.env.GIFS_MAX_MEGAPIXELS, 50);
const MAX_PIXELS = Math.floor(MAX_MEGAPIXELS * 1_000_000);
const MEDIA_TIMEOUT_MS = Math.floor(
  parsePositiveNumber(process.env.GIFS_MEDIA_TIMEOUT_SECONDS, 60) * 1000,
);

function parseIdList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const DISCORD_ALLOWED_USER_IDS = parseIdList(process.env.DISCORD_ALLOWED_USER_IDS);
const DISCORD_CHANNEL_IDS = parseIdList(process.env.DISCORD_CHANNEL_IDS);
const DISCORD_PUBLIC_ORIGIN = (process.env.DISCORD_PUBLIC_ORIGIN || "").replace(/\/+$/, "");
const DISCORD_RATE_LIMIT_MAX = Math.floor(
  parsePositiveNumber(process.env.DISCORD_RATE_LIMIT_MAX, 10),
);
const DISCORD_RATE_LIMIT_WINDOW_MS =
  parsePositiveNumber(process.env.DISCORD_RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000;

const STORAGE_DIR =
  process.env.TEST_STORAGE_DIR || (IS_PRODUCTION ? "/data" : path.join(process.cwd(), "data"));

const DATA_DIR = STORAGE_DIR;
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FRONTEND_DIST =
  process.env.TEST_FRONTEND_DIST || path.join(import.meta.dirname, "..", "..", "dist");

export default {
  BASE_PATH,
  MOUNT_PATH,
  TRUST_PROXY,
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PUBLIC_CATEGORY,
  PUBLIC_API_SPEED_LIMIT,
  PUBLIC_ORIGIN,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_IMPORT_URLS,
  DEFAULT_CATEGORY_ID,
  ALLOWED_IMPORT_DOMAINS,
  MAX_FILE_SIZE_MB,
  MAX_FILE_SIZE_BYTES,
  MAX_MEGAPIXELS,
  MAX_PIXELS,
  MEDIA_TIMEOUT_MS,
  DISCORD_BOT_TOKEN,
  DISCORD_ALLOWED_USER_IDS,
  DISCORD_CHANNEL_IDS,
  DISCORD_PUBLIC_ORIGIN,
  DISCORD_RATE_LIMIT_MAX,
  DISCORD_RATE_LIMIT_WINDOW_MS,
  FRONTEND_DIST,
  UPLOAD_DIR,
  DATA_DIR,
  ENABLE_FILE_LOGGING: process.env.LOG_TO_FILE === "1" || process.env.LOG_TO_FILE === "true",
  LOG_FILE_PATH: path.join(DATA_DIR, "access.log"),
  STATS_FILE_PATH: path.join(DATA_DIR, "log_statistics.txt"),
};
