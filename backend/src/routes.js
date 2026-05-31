const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");
const { execFile } = require("child_process");
const os = require("os");
const util = require("util");
const fsPromises = fs.promises;
const execFilePromise = util.promisify(execFile);
const {
  authMiddleware,
  credentialsAreValid,
  issueToken,
  cookieOptions,
  verifyToken,
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
} = require("./auth");
const {
  addGif,
  listGifs,
  findGifBySlug,
  deleteGifBySlug,
  listCategories,
  addCategory,
  deleteCategoryById,
  setGifCategories,
  getGifsByCategory,
} = require("./database");
const config = require("./config");
const validDomains = require("./valid-domains");
const { safeFetch } = require("./net-guard");
const { createRateLimiter } = require("./rate-limit");

const publicApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
});

function isWhitelistedUrl(url) {
  return validDomains.some(
    (domain) =>
      url.hostname === domain || url.hostname.endsWith("." + domain),
  );
}

const router = express.Router();

const ALLOWED_MIME_TYPES = new Set(["image/gif", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set([".gif", ".webp"]);
const MIME_EXTENSION_MAP = {
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const EXTENSION_MIME_MAP = {
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function resolveFileExtension(file) {
  const originalExt = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(originalExt)) {
    return originalExt;
  }
  const mappedExt = MIME_EXTENSION_MAP[file.mimetype];
  return mappedExt || ".gif";
}

function extensionFromFilename(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    return ext.slice(1);
  }
  return "gif";
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = resolveFileExtension(file);
    const uniqueName = `${Date.now()}-${nanoid(6)}${safeExt}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Only GIF or WebP uploads are allowed."));
    }
    cb(null, true);
  },
});

function buildShareUrl(req, slug, filename) {
  const extension = extensionFromFilename(filename);
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0] : req.protocol;
  const host = req.get("host");
  return `${protocol}://${host}${config.BASE_PATH}/share/${slug}.${extension}`;
}

router.post("/api/login", express.json(), (req, res) => {
  const rateLimitStatus = checkLoginRateLimit(req);
  if (!rateLimitStatus.allowed) {
    return res.status(429).json({ error: "Invalid credentials." });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required." });
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
  } catch (error) {
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
    const categoryName = config.PUBLIC_GIF_CATEGORY;
    if (!categoryName) {
      return res.status(404).json({ error: "No public category configured." });
    }
    const gifs = await getGifsByCategory(categoryName);

    const gifsWithUrls = gifs.map((g) => ({
      ...g,
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

router.get("/api/categories", authMiddleware, async (req, res, next) => {
  try {
    const categories = await listCategories();
    return res.json({ categories });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/api/categories",
  authMiddleware,
  express.json(),
  async (req, res, next) => {
    const { name } = req.body || {};
    try {
      const category = await addCategory(name);
      if (!category) {
        return res.status(500).json({ error: "Failed to create category." });
      }
      return res.status(201).json({ category });
    } catch (error) {
      if (error?.code === "CATEGORY_NAME_REQUIRED") {
        return res.status(400).json({ error: error.message });
      }
      if (error?.code === "CATEGORY_NAME_DUPLICATE") {
        return res.status(409).json({ error: error.message });
      }
      return next(error);
    }
  },
);

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

router.put(
  "/api/gifs/:slug/categories",
  authMiddleware,
  express.json(),
  async (req, res, next) => {
    const { slug } = req.params;
    const { categoryIds } = req.body || {};
    try {
      const categories = await setGifCategories(slug, categoryIds);
      if (categories === null) {
        return res.status(404).json({ error: "GIF not found." });
      }
      return res.json({ categories });
    } catch (error) {
      if (error?.code === "CATEGORY_NOT_FOUND") {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  },
);

router.post("/api/upload", authMiddleware, (req, res, next) => {
  upload.single("gif")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const slug = nanoid(10);
    return addGif({
      slug,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    })
      .then(() => {
        res.status(201).json({
          slug,
          shareUrl: buildShareUrl(req, slug, req.file.filename),
        });
      })
      .catch((dbError) => {
        fs.unlink(path.resolve(config.UPLOAD_DIR, req.file.filename), () => {});
        next(dbError);
      });
  });
});

async function serveSharedGif(req, res, next) {
  const { slug, ext: requestedExtParam } = req.params;
  const clientIp = req.ip || req.connection?.remoteAddress || "unknown-ip";
  const referer = req.get("referer") || req.get("referrer") || "no-referer";
  console.log(
    `[share-access] slug=${slug} from ${clientIp} referer=${referer}`,
  );
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
    const requestedExtension = requestedExtParam
      ? `.${requestedExtParam.toLowerCase()}`
      : null;
    if (
      requestedExtension &&
      storedExtension &&
      requestedExtension !== storedExtension
    ) {
      return res.redirect(301, buildShareUrl(req, gif.slug, gif.filename));
    }
    const mimeType =
      gif.mimeType || EXTENSION_MIME_MAP[storedExtension] || "image/gif";
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
    const shareUrl = buildShareUrl(req, gif.slug, gif.filename);
    return res.redirect(301, shareUrl);
  } catch (error) {
    return next(error);
  }
});

router.delete("/api/gifs/:slug", authMiddleware, async (req, res, next) => {
  const { slug } = req.params;
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
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: "urls must be an array" });
  }

  const results = [];
  const MAX_DOWNLOAD_SIZE = 15 * 1024 * 1024;

  for (const urlStr of urls) {
    const result = { url: urlStr, success: false };
    try {
      let url;
      try {
        url = new URL(urlStr);
      } catch (e) {
        throw new Error("Invalid URL");
      }

      if (!isWhitelistedUrl(url)) {
        throw new Error("Domain not whitelisted");
      }

      const tempDir = path.join(os.tmpdir(), `gifselector-import-${nanoid()}`);
      await fsPromises.mkdir(tempDir);

      try {
        try {
          await execFilePromise("gallery-dl", ["--directory", tempDir, urlStr]);
        } catch (dlError) {
          console.warn(
            `[Import] gallery-dl failed for ${urlStr}, attempting fallback.`,
          );

          const pageResp = await safeFetch(urlStr, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; GifSelector/1.0; +http://localhost)",
            },
          });
          if (!pageResp.ok)
            throw new Error(
              `Fallback fetch failed: ${pageResp.status} ${pageResp.statusText}`,
            );

          const html = await pageResp.text();

          const extractMeta = (prop) => {
            const regex = new RegExp(
              `<meta\\s+(?:property|name)=["']${prop}["']\\s+content=["']([^"']+)["']`,
              "i",
            );
            const match = html.match(regex);
            return match ? match[1] : null;
          };

          let mediaUrl =
            extractMeta("og:video") ||
            extractMeta("og:video:url") ||
            extractMeta("og:image") ||
            extractMeta("twitter:image");

          if (!mediaUrl) {
            throw new Error("No media found via metadata fallback");
          }

          mediaUrl = mediaUrl.replace(/&amp;/g, "&");

          let parsedMediaUrl;
          try {
            parsedMediaUrl = new URL(mediaUrl, urlStr);
          } catch (e) {
            throw new Error("Invalid media URL in metadata");
          }
          if (!isWhitelistedUrl(parsedMediaUrl)) {
            throw new Error("Media URL domain not whitelisted");
          }
          mediaUrl = parsedMediaUrl.toString();

          const mediaResp = await safeFetch(mediaUrl, {
            headers: { "User-Agent": "GifSelector/1.0" },
          });

          if (!mediaResp.ok) {
            throw new Error(`Fallback download failed: ${mediaResp.status}`);
          }

          const contentLength = mediaResp.headers.get("content-length");
          if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
            throw new Error("Fallback media file too large");
          }

          const buffer = await mediaResp.arrayBuffer();
          if (buffer.byteLength > MAX_DOWNLOAD_SIZE) {
            throw new Error("Fallback media file too large");
          }

          let ext = path.extname(new URL(mediaUrl).pathname);
          if (!ext || ext.length > 5) {
            const cType = mediaResp.headers.get("content-type") || "";
            if (cType.includes("video/mp4")) ext = ".mp4";
            else if (cType.includes("image/gif")) ext = ".gif";
            else if (cType.includes("image/webp")) ext = ".webp";
          }
          if (!ext) ext = ".gif";

          const savePath = path.join(tempDir, `fallback-download${ext}`);
          await fsPromises.writeFile(savePath, Buffer.from(buffer));
        }

        const findFiles = async (dir) => {
          const files = [];
          const entries = await fsPromises.readdir(dir, {
            withFileTypes: true,
          });
          for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              files.push(...(await findFiles(entryPath)));
            } else {
              files.push(entryPath);
            }
          }
          return files;
        };

        const downloadedFiles = await findFiles(tempDir);

        if (downloadedFiles.length === 0) {
          throw new Error("No files downloaded by gallery-dl");
        }

        let foundValid = false;
        for (const filePath of downloadedFiles) {
          if (foundValid) break;

          const ext = path.extname(filePath).toLowerCase();
          const isMp4 = ext === ".mp4";
          if (!ALLOWED_EXTENSIONS.has(ext) && !isMp4) {
            continue;
          }

          let finalFilePath = filePath;
          let finalExt = ext;
          let finalMimeType = isMp4 ? "video/mp4" : EXTENSION_MIME_MAP[ext];

          if (finalExt === ".gif" || isMp4) {
            const webpPath = filePath.replace(
              new RegExp(`${ext}$`, "i"),
              ".webp",
            );
            let conversionSuccess = false;

            if (isMp4) {
              try {
                await execFilePromise("ffmpeg", [
                  "-y",
                  "-i",
                  filePath,
                  "-vcodec",
                  "libwebp",
                  "-loop",
                  "0",
                  "-compression_level",
                  "4",
                  "-q:v",
                  "75",
                  "-an",
                  webpPath,
                ]);
                await fsPromises.access(webpPath);
                conversionSuccess = true;
              } catch (e) {
                console.warn(
                  `ffmpeg conversion failed for ${filePath}: ${e.message}`,
                );
              }
            }

            if (!conversionSuccess) {
              try {
                await execFilePromise("magick", [
                  filePath,
                  "-coalesce",
                  "-quality",
                  "80",
                  webpPath,
                ]);
                await fsPromises.access(webpPath);
                conversionSuccess = true;
              } catch (errMagick) {
                try {
                  await execFilePromise("convert", [
                    filePath,
                    "-coalesce",
                    "-quality",
                    "80",
                    webpPath,
                  ]);
                  await fsPromises.access(webpPath);
                  conversionSuccess = true;
                } catch (errConvert) {
                  console.warn(
                    `ImageMagick conversion failed for ${filePath}: ${errConvert.message}`,
                  );
                }
              }
            }

            if (conversionSuccess) {
              finalFilePath = webpPath;
              finalExt = ".webp";
              finalMimeType = "image/webp";
            } else if (isMp4) {
              const gifPath = filePath.replace(
                new RegExp(`${ext}$`, "i"),
                ".gif",
              );
              try {
                await execFilePromise("ffmpeg", [
                  "-y",
                  "-i",
                  filePath,
                  gifPath,
                ]);
                await fsPromises.access(gifPath);

                finalFilePath = gifPath;
                finalExt = ".gif";
                finalMimeType = "image/gif";
              } catch (e) {
                console.warn(
                  `Fallback MP4->GIF conversion failed: ${e.message}`,
                );
              }
            }
          }

          if (finalExt === ".mp4") {
            continue;
          }

          const stats = await fsPromises.stat(finalFilePath);
          if (stats.size > MAX_DOWNLOAD_SIZE) {
            continue;
          }

          const uniqueName = `${Date.now()}-${nanoid(6)}${finalExt}`;
          const savePath = path.join(config.UPLOAD_DIR, uniqueName);

          await fsPromises.copyFile(finalFilePath, savePath);

          const slug = nanoid(10);
          const originalName = path.basename(filePath);

          await addGif({
            slug,
            filename: uniqueName,
            originalName,
            mimeType: finalMimeType,
            sizeBytes: stats.size,
          });

          result.success = true;
          result.slug = slug;
          foundValid = true;
        }

        if (!foundValid && downloadedFiles.length > 0) {
          throw new Error(
            "Downloaded files were not valid GIFs/WebPs or were too large.",
          );
        }
      } finally {
        await fsPromises
          .rm(tempDir, { recursive: true, force: true })
          .catch(() => {});
      }
    } catch (err) {
      result.error = err.message;
    }
    results.push(result);
  }

  res.json({ results });
});

module.exports = router;
