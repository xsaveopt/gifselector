import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import {
  authMiddleware,
  checkLoginRateLimit,
  cookieOptions,
  credentialsAreValid,
  issueToken,
  recordFailedLogin,
  recordSuccessfulLogin,
  verifyToken,
} from "./auth.ts";
import {
  addGif,
  deleteCategoryById,
  deleteGifBySlug,
  findGifBySlug,
  getGifsByCategory,
  listCategories,
  listGifs,
  setGifCategories,
  addCategory,
} from "./database.ts";
import config from "./config.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { toError } from "./errors.ts";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  EXTENSION_MIME_MAP,
  MIME_EXTENSION_MAP,
  ensureAnimated,
  extensionFromFilename,
  importFromUrl,
  type ImportResult,
} from "./importer.ts";
import { assertValidImage, sanitizeInPlace } from "./media-guard.ts";
import { sanitize } from "./logger.ts";

const fsPromises = fs.promises;

const publicApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
});

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

const router = express.Router();

function resolveFileExtension(file: Express.Multer.File): string {
  const originalExt = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(originalExt)) {
    return originalExt;
  }
  const mappedExt = MIME_EXTENSION_MAP[file.mimetype];
  return mappedExt || ".gif";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeExt = resolveFileExtension(file);
    const uniqueName = `${Date.now()}-${nanoid(6)}${safeExt}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Only GIF or WebP uploads are allowed."));
      return;
    }
    cb(null, true);
  },
});

const HOST_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;

export function buildSharePath(slug: string, filename: string): string {
  return `${config.BASE_PATH}/share/${slug}.${extensionFromFilename(filename)}`;
}

function requestOrigin(req: Request): string {
  if (config.PUBLIC_ORIGIN) {
    return config.PUBLIC_ORIGIN;
  }
  const forwardedProto = (req.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "http";
  const host = req.get("host") || "";
  if (!HOST_PATTERN.test(host)) {
    return "";
  }
  return `${protocol}://${host}`;
}

function buildShareUrl(req: Request, slug: string, filename: string): string {
  return `${requestOrigin(req)}${buildSharePath(slug, filename)}`;
}

router.post("/api/login", express.json(), (req, res) => {
  const rateLimitStatus = checkLoginRateLimit(req);
  if (!rateLimitStatus.allowed) {
    return res.status(429).json({ error: "Invalid credentials." });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (!credentialsAreValid(username, password)) {
    const status = recordFailedLogin(req);
    if (status.blocked) {
      return res.status(429).json({ error: "Invalid credentials." });
    }
    return res.status(401).json({ error: "Invalid credentials." });
  }

  recordSuccessfulLogin(req);
  const token = issueToken(username);
  res.cookie("authToken", token, cookieOptions());
  return res.json({ success: true });
});

router.post("/api/logout", (req, res) => {
  res.clearCookie("authToken", { ...cookieOptions(), maxAge: 0 });
  return res.json({ success: true });
});

router.get("/api/session", (req, res) => {
  const token = req.cookies?.authToken;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    const payload = verifyToken(token);
    return res.json({ authenticated: true, username: payload.username });
  } catch {
    return res.json({ authenticated: false });
  }
});

router.get("/api/gifs", authMiddleware, async (req, res, next) => {
  try {
    const storedGifs = await listGifs();
    const gifs = storedGifs.map((gif) => ({
      id: gif.id,
      slug: gif.slug,
      originalName: gif.originalName,
      sizeBytes: gif.sizeBytes,
      createdAt: gif.createdAt,
      mimeType: gif.mimeType,
      shareUrl: buildShareUrl(req, gif.slug, gif.filename),
      categories: Array.isArray(gif.categories)
        ? gif.categories.map((category) => ({
            id: category.id,
            name: category.name,
          }))
        : [],
    }));
    return res.json({ gifs, total: storedGifs.length });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/public/gifs", publicApiLimiter, async (req, res, next) => {
  try {
    const categoryName = config.PUBLIC_CATEGORY;
    if (!categoryName) {
      return res.status(404).json({ error: "No public category configured." });
    }
    const gifs = await getGifsByCategory(categoryName);

    const gifsWithUrls = gifs.map((g) => ({
      slug: g.slug,
      originalName: g.originalName,
      sizeBytes: g.sizeBytes,
      createdAt: g.createdAt,
      mimeType: g.mimeType,
      shareUrl: buildShareUrl(req, g.slug, g.filename),
    }));

    const jsonString = JSON.stringify({ gifs: gifsWithUrls });
    const buffer = Buffer.from(jsonString, "utf-8");

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Length", buffer.length);

    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      Expires: new Date(Date.now() + 31536000000).toUTCString(),
    });

    const CHUNK_SIZE = 16 * 1024;
    const SPEED_LIMIT = config.PUBLIC_API_SPEED_LIMIT;

    let offset = 0;

    function sendNextChunk() {
      if (res.writableEnded) return;

      const end = Math.min(offset + CHUNK_SIZE, buffer.length);
      const chunk = buffer.slice(offset, end);

      if (chunk.length === 0) {
        res.end();
        return;
      }

      res.write(chunk);
      offset = end;

      if (offset < buffer.length) {
        const delayMs = (chunk.length / SPEED_LIMIT) * 1000;
        setTimeout(sendNextChunk, delayMs);
      } else {
        res.end();
      }
    }

    sendNextChunk();
  } catch (error) {
    next(error);
  }
});

router.get("/api/categories", authMiddleware, async (_req, res, next) => {
  try {
    const categories = await listCategories();
    return res.json({ categories });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/categories", authMiddleware, express.json(), async (req, res, next) => {
  const { name } = req.body || {};
  try {
    const category = await addCategory(name);
    if (!category) {
      return res.status(500).json({ error: "Failed to create category." });
    }
    return res.status(201).json({ category });
  } catch (error) {
    const err = toError(error);
    if (err.code === "CATEGORY_NAME_REQUIRED" || err.code === "CATEGORY_NAME_TOO_LONG") {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === "CATEGORY_NAME_DUPLICATE") {
      return res.status(409).json({ error: err.message });
    }
    return next(err);
  }
});

router.delete("/api/categories/:id", authMiddleware, async (req, res, next) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ error: "Invalid category id." });
  }
  try {
    const deleted = await deleteCategoryById(categoryId);
    if (!deleted) {
      return res.status(404).json({ error: "Category not found." });
    }
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.put("/api/gifs/:slug/categories", authMiddleware, express.json(), async (req, res, next) => {
  const slug = routeParam(req.params.slug);
  const { categoryIds } = req.body || {};
  try {
    const categories = await setGifCategories(slug, categoryIds);
    if (categories === null) {
      return res.status(404).json({ error: "GIF not found." });
    }
    return res.json({ categories });
  } catch (error) {
    const err = toError(error);
    if (err.code === "CATEGORY_NOT_FOUND") {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

router.post("/api/upload", authMiddleware, (req, res, next) => {
  upload.single("gif")(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: toError(err).message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const slug = nanoid(10);
    let filePath = path.resolve(config.UPLOAD_DIR, req.file.filename);
    let filename = req.file.filename;
    let mimeType = req.file.mimetype;
    let sizeBytes = req.file.size;

    try {
      const kind = await assertValidImage(filePath, ["gif", "webp"]);
      mimeType = MIME_EXTENSION_MAP[`image/${kind}`] ? `image/${kind}` : mimeType;
      const detectedExt = `.${kind}`;
      if (path.extname(filename).toLowerCase() !== detectedExt) {
        const renamed = `${path.basename(filename, path.extname(filename))}${detectedExt}`;
        const renamedPath = path.resolve(config.UPLOAD_DIR, renamed);
        await fsPromises.rename(filePath, renamedPath);
        filePath = renamedPath;
        filename = renamed;
      }
      await sanitizeInPlace(filePath, kind);
    } catch (validationError) {
      await fsPromises.rm(filePath, { force: true }).catch(() => {});
      return res.status(400).json({ error: toError(validationError).message });
    }

    try {
      const animatedPath = await ensureAnimated(filePath);
      if (animatedPath) {
        filePath = animatedPath;
        filename = path.basename(animatedPath);
        mimeType = EXTENSION_MIME_MAP[path.extname(animatedPath).toLowerCase()] || mimeType;
      }
      sizeBytes = (await fsPromises.stat(filePath)).size;
    } catch (e) {
      console.warn(`ensureAnimated failed for ${filePath}: ${toError(e).message}`);
    }
    return addGif({
      slug,
      filename,
      originalName: req.file.originalname,
      mimeType,
      sizeBytes,
    })
      .then(() => {
        res.status(201).json({
          slug,
          shareUrl: buildShareUrl(req, slug, filename),
        });
      })
      .catch((dbError: unknown) => {
        fs.unlink(filePath, () => {});
        next(dbError);
      });
  });
});

async function serveSharedGif(req: Request, res: Response, next: (error?: unknown) => void) {
  const slug = routeParam(req.params.slug);
  const requestedExtParam = routeParam(req.params.ext);
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown-ip";
  const referer = sanitize(req.get("referer") || req.get("referrer") || "no-referer");
  console.log(`[share-access] slug=${sanitize(slug)} from ${clientIp} referer=${referer}`);
  try {
    const gif = await findGifBySlug(slug);
    if (!gif) {
      return res.status(404).json({ error: "GIF not found." });
    }
    const filePath = path.resolve(config.UPLOAD_DIR, gif.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "GIF file missing." });
    }
    const storedExtension = path.extname(gif.filename).toLowerCase();
    const requestedExtension = requestedExtParam ? `.${requestedExtParam.toLowerCase()}` : null;
    if (requestedExtension && storedExtension && requestedExtension !== storedExtension) {
      return res.redirect(301, buildSharePath(gif.slug, gif.filename));
    }
    const mimeType = gif.mimeType || EXTENSION_MIME_MAP[storedExtension] || "image/gif";
    res.type(mimeType);
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      Expires: new Date(Date.now() + 31536000000).toUTCString(),
    });
    return res.sendFile(filePath);
  } catch (error) {
    return next(error);
  }
}

router.get("/share/:slug.:ext", serveSharedGif);

router.get("/share/:slug", async (req, res, next) => {
  try {
    const gif = await findGifBySlug(req.params.slug);
    if (!gif) {
      return res.status(404).json({ error: "GIF not found." });
    }
    return res.redirect(301, buildSharePath(gif.slug, gif.filename));
  } catch (error) {
    return next(error);
  }
});

router.delete("/api/gifs/:slug", authMiddleware, async (req, res, next) => {
  const slug = routeParam(req.params.slug);
  try {
    const gif = await findGifBySlug(slug);
    if (!gif) {
      return res.status(404).json({ error: "GIF not found." });
    }
    const filePath = path.resolve(config.UPLOAD_DIR, gif.filename);
    const deleted = await deleteGifBySlug(slug);
    if (!deleted) {
      return res.status(404).json({ error: "GIF not found." });
    }
    await fsPromises.unlink(filePath).catch(() => {});
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/import", authMiddleware, express.json(), async (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: "urls must be an array" });
  }
  if (urls.length > config.MAX_IMPORT_URLS) {
    return res
      .status(400)
      .json({ error: `At most ${config.MAX_IMPORT_URLS} urls may be imported per request.` });
  }

  const results: ImportResult[] = [];
  for (const urlStr of urls) {
    results.push(await importFromUrl(urlStr));
  }

  res.json({ results });
});

export default router;
