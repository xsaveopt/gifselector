const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

function normalizeBasePath(input) {
  if (!input) {
    return '/gifselector';
  }
  if (!input.startsWith('/')) {
    input = `/${input}`;
  }
  if (input.length > 1 && input.endsWith('/')) {
    input = input.slice(0, -1);
  }
  return input;
}

const BASE_PATH = normalizeBasePath(process.env.BACKEND_BASE_PATH);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

function ensureAbsolutePath(label, targetPath) {
  if (!targetPath) {
    throw new Error(`${label} must be provided as an absolute path.`);
  }
  if (!path.isAbsolute(targetPath)) {
    throw new Error(`${label} must be an absolute path. Received: ${targetPath}`);
  }
  return targetPath;
}

const defaultUploadDir = process.env.NODE_ENV === 'production'
  ? '/app/backend/uploads'
  : path.join(process.cwd(), 'uploads');

const resolvedUploadDir = ensureAbsolutePath(
  'UPLOAD_DIR',
  process.env.UPLOAD_DIR || defaultUploadDir
);

if (!fs.existsSync(resolvedUploadDir)) {
  fs.mkdirSync(resolvedUploadDir, { recursive: true });
}

const defaultFrontendDist = process.env.NODE_ENV === 'production'
  ? '/app/frontend/dist'
  : path.join(process.cwd(), '..', 'frontend', 'dist');

const FRONTEND_DIST = ensureAbsolutePath(
  'FRONTEND_DIST',
  process.env.FRONTEND_DIST || defaultFrontendDist
);

module.exports = {
  BASE_PATH,
  JWT_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  FRONTEND_DIST,
  UPLOAD_DIR: resolvedUploadDir
};
