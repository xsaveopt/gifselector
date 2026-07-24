import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import util from "node:util";
import { execFile } from "node:child_process";
import { nanoid } from "nanoid";
import { addGif } from "./database.ts";
import config from "./config.ts";
import { safeFetch } from "./net-guard.ts";
import { toError } from "./errors.ts";

const fsPromises = fs.promises;
const execFilePromise = util.promisify(execFile);

export const ALLOWED_MIME_TYPES = new Set(["image/gif", "image/webp"]);
export const ALLOWED_EXTENSIONS = new Set([".gif", ".webp"]);
export const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/gif": ".gif",
  "image/webp": ".webp",
};
export const EXTENSION_MIME_MAP: Record<string, string> = {
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const MAX_DOWNLOAD_SIZE = 15 * 1024 * 1024;

export function isWhitelistedUrl(url: URL): boolean {
  return config.ALLOWED_IMPORT_DOMAINS.some(
    (domain) => url.hostname === domain || url.hostname.endsWith("." + domain),
  );
}

export function extensionFromFilename(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    return ext.slice(1);
  }
  return "gif";
}

async function getFrameCount(filePath: string): Promise<number> {
  const commands: [string, string[]][] = [
    ["magick", ["identify", "-format", "%n\n", filePath]],
    ["identify", ["-format", "%n\n", filePath]],
  ];
  for (const [bin, args] of commands) {
    try {
      const { stdout } = await execFilePromise(bin, args);
      const count = parseInt(stdout.trim().split("\n")[0], 10);
      if (Number.isFinite(count)) {
        return count;
      }
    } catch {
      continue;
    }
  }
  return 1;
}

export async function ensureAnimated(filePath: string): Promise<string | null> {
  const frames = await getFrameCount(filePath);
  if (frames > 1) {
    return null;
  }
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  const outPath = `${base}.gif`;
  const tmpPath = `${base}-anim-${nanoid(6)}.gif`;
  const args = [
    filePath,
    "-coalesce",
    "-duplicate",
    "1",
    "-loop",
    "0",
    "-set",
    "delay",
    "100",
    tmpPath,
  ];
  for (const cmd of ["magick", "convert"]) {
    try {
      await execFilePromise(cmd, args);
      await fsPromises.access(tmpPath);
      if (outPath !== filePath) {
        await fsPromises.rm(filePath, { force: true }).catch(() => {});
      }
      await fsPromises.rename(tmpPath, outPath);
      return outPath;
    } catch {
      await fsPromises.rm(tmpPath, { force: true }).catch(() => {});
    }
  }
  return null;
}

export interface ImportResult {
  url: unknown;
  success: boolean;
  slug?: string;
  filename?: string;
  error?: string;
}

export interface ImportOptions {
  trusted?: boolean;
}

export async function importFromUrl(
  urlStr: unknown,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = { url: urlStr, success: false };
  try {
    if (typeof urlStr !== "string") {
      throw new Error("Invalid URL");
    }

    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      throw new Error("Invalid URL");
    }

    if (!options.trusted && !isWhitelistedUrl(url)) {
      throw new Error("Domain not whitelisted");
    }

    const tempDir = path.join(os.tmpdir(), `gifselector-import-${nanoid()}`);
    await fsPromises.mkdir(tempDir);

    try {
      try {
        await execFilePromise("gallery-dl", ["--directory", tempDir, urlStr]);
      } catch {
        console.warn(`[Import] gallery-dl failed for ${urlStr}, attempting fallback.`);

        const pageResp = await safeFetch(urlStr, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GifSelector/1.0; +http://localhost)",
          },
        });
        if (!pageResp.ok)
          throw new Error(`Fallback fetch failed: ${pageResp.status} ${pageResp.statusText}`);

        const contentType = pageResp.headers.get("content-type") || "";
        if (/^(image|video)\//i.test(contentType)) {
          const buffer = await pageResp.arrayBuffer();
          if (buffer.byteLength > MAX_DOWNLOAD_SIZE) {
            throw new Error("Fallback media file too large");
          }
          let ext = path.extname(url.pathname).toLowerCase();
          if (!ext || ext.length > 5) {
            if (contentType.includes("video/mp4")) ext = ".mp4";
            else if (contentType.includes("image/gif")) ext = ".gif";
            else if (contentType.includes("image/webp")) ext = ".webp";
          }
          if (!ext) ext = ".gif";
          const savePath = path.join(tempDir, `fallback-download${ext}`);
          await fsPromises.writeFile(savePath, Buffer.from(buffer));
        } else {
          const html = await pageResp.text();

          const extractMeta = (prop: string): string | null => {
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

          let parsedMediaUrl: URL;
          try {
            parsedMediaUrl = new URL(mediaUrl, urlStr);
          } catch {
            throw new Error("Invalid media URL in metadata");
          }
          if (!options.trusted && !isWhitelistedUrl(parsedMediaUrl)) {
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
      }

      const findFiles = async (dir: string): Promise<string[]> => {
        const files: string[] = [];
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
      for (const downloadedPath of downloadedFiles) {
        if (foundValid) break;

        const ext = path.extname(downloadedPath).toLowerCase();
        const isMp4 = ext === ".mp4";
        if (!ALLOWED_EXTENSIONS.has(ext) && !isMp4) {
          continue;
        }

        let finalFilePath = downloadedPath;
        let finalExt = ext;
        let finalMimeType = isMp4 ? "video/mp4" : EXTENSION_MIME_MAP[ext];

        if (finalExt === ".gif" || isMp4) {
          const webpPath = downloadedPath.replace(new RegExp(`${ext}$`, "i"), ".webp");
          let conversionSuccess = false;

          if (isMp4) {
            try {
              await execFilePromise("ffmpeg", [
                "-y",
                "-i",
                downloadedPath,
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
              console.warn(`ffmpeg conversion failed for ${downloadedPath}: ${toError(e).message}`);
            }
          }

          if (!conversionSuccess) {
            try {
              await execFilePromise("magick", [
                downloadedPath,
                "-coalesce",
                "-quality",
                "80",
                webpPath,
              ]);
              await fsPromises.access(webpPath);
              conversionSuccess = true;
            } catch {
              try {
                await execFilePromise("convert", [
                  downloadedPath,
                  "-coalesce",
                  "-quality",
                  "80",
                  webpPath,
                ]);
                await fsPromises.access(webpPath);
                conversionSuccess = true;
              } catch (errConvert) {
                console.warn(
                  `ImageMagick conversion failed for ${downloadedPath}: ${toError(errConvert).message}`,
                );
              }
            }
          }

          if (conversionSuccess) {
            finalFilePath = webpPath;
            finalExt = ".webp";
            finalMimeType = "image/webp";
          } else if (isMp4) {
            const gifPath = downloadedPath.replace(new RegExp(`${ext}$`, "i"), ".gif");
            try {
              await execFilePromise("ffmpeg", ["-y", "-i", downloadedPath, gifPath]);
              await fsPromises.access(gifPath);

              finalFilePath = gifPath;
              finalExt = ".gif";
              finalMimeType = "image/gif";
            } catch (e) {
              console.warn(`Fallback MP4->GIF conversion failed: ${toError(e).message}`);
            }
          }
        }

        if (finalExt === ".mp4") {
          continue;
        }

        try {
          const animatedPath = await ensureAnimated(finalFilePath);
          if (animatedPath) {
            finalFilePath = animatedPath;
            finalExt = path.extname(animatedPath).toLowerCase();
            finalMimeType = EXTENSION_MIME_MAP[finalExt] || finalMimeType;
          }
        } catch (e) {
          console.warn(`ensureAnimated failed for ${finalFilePath}: ${toError(e).message}`);
        }

        const stats = await fsPromises.stat(finalFilePath);
        if (stats.size > MAX_DOWNLOAD_SIZE) {
          continue;
        }

        const uniqueName = `${Date.now()}-${nanoid(6)}${finalExt}`;
        const savePath = path.join(config.UPLOAD_DIR, uniqueName);

        await fsPromises.copyFile(finalFilePath, savePath);

        const slug = nanoid(10);
        const originalName = path.basename(downloadedPath);

        await addGif({
          slug,
          filename: uniqueName,
          originalName,
          mimeType: finalMimeType,
          sizeBytes: stats.size,
        });

        result.success = true;
        result.slug = slug;
        result.filename = uniqueName;
        foundValid = true;
      }

      if (!foundValid && downloadedFiles.length > 0) {
        throw new Error("Downloaded files were not valid GIFs/WebPs or were too large.");
      }
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    result.error = toError(err).message;
  }
  return result;
}
