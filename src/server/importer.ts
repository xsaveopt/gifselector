import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import util from "node:util";
import { execFile } from "node:child_process";
import { nanoid } from "nanoid";
import { addGif } from "./database.ts";
import config from "./config.ts";
import { safeFetch } from "./net-guard.ts";
import {
  assertValidImage,
  assertWithinPixelBudget,
  detectFileMediaKind,
  detectMediaKind,
  pinnedInput,
  runMagick,
  sanitizeInPlace,
  SIGNATURE_HEADER_BYTES,
  type MediaKind,
} from "./media-guard.ts";

import { toError } from "./errors.ts";

const fsPromises = fs.promises;
const execFilePromise = util.promisify(execFile);

const FFMPEG_INPUT_ARGS = [
  "-y",
  "-loglevel",
  "error",
  "-protocol_whitelist",
  "file",
  "-f",
  "mov,mp4,m4a,3gp,3g2,mj2",
  "-i",
];

const FFMPEG_WEBP_ARGS = [
  "-map_metadata",
  "-1",
  "-vcodec",
  "libwebp",
  "-loop",
  "0",
  "-compression_level",
  "4",
  "-q:v",
  "75",
  "-an",
];

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

export const MAX_DOWNLOAD_SIZE = config.MAX_FILE_SIZE_BYTES;

function tooLargeError(bytes?: number): Error {
  const seen = bytes === undefined ? "" : ` (${Math.round(bytes / 1024 / 1024)} MB)`;
  return new Error(`Media file exceeds the ${config.MAX_FILE_SIZE_MB} MB limit${seen}`);
}

function assertAdvertisedSizeAllowed(response: Response): void {
  const contentLength = response.headers.get("content-length");
  if (!contentLength) {
    return;
  }
  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > MAX_DOWNLOAD_SIZE) {
    throw tooLargeError(bytes);
  }
}

async function readCappedBody(response: Response): Promise<Buffer> {
  assertAdvertisedSizeAllowed(response);
  if (!response.body) {
    throw new Error("Response had no body");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_DOWNLOAD_SIZE) {
      throw tooLargeError();
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function assertBufferIsMedia(buffer: Buffer): void {
  if (!detectMediaKind(buffer.subarray(0, SIGNATURE_HEADER_BYTES))) {
    throw new Error("Downloaded data is not a GIF, WebP or MP4 file");
  }
}

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
    ["magick", ["identify", "-ping", "-format", "%n\n", filePath]],
    ["identify", ["-ping", "-format", "%n\n", filePath]],
  ];
  for (const [bin, args] of commands) {
    try {
      const { stdout } = await execFilePromise(bin, args, { timeout: config.MEDIA_TIMEOUT_MS });
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
  try {
    await runMagick([
      filePath,
      "-coalesce",
      "-strip",
      "-duplicate",
      "1",
      "-loop",
      "0",
      "-set",
      "delay",
      "100",
      `GIF:${tmpPath}`,
    ]);
    await fsPromises.access(tmpPath);
    if (outPath !== filePath) {
      await fsPromises.rm(filePath, { force: true }).catch(() => {});
    }
    await fsPromises.rename(tmpPath, outPath);
    return outPath;
  } catch {
    await fsPromises.rm(tmpPath, { force: true }).catch(() => {});
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
        await execFilePromise(
          "gallery-dl",
          ["--filesize-max", String(MAX_DOWNLOAD_SIZE), "--directory", tempDir, urlStr],
          { timeout: config.MEDIA_TIMEOUT_MS },
        );
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
          const buffer = await readCappedBody(pageResp);
          assertBufferIsMedia(buffer);
          let ext = path.extname(url.pathname).toLowerCase();
          if (!ext || ext.length > 5) {
            if (contentType.includes("video/mp4")) ext = ".mp4";
            else if (contentType.includes("image/gif")) ext = ".gif";
            else if (contentType.includes("image/webp")) ext = ".webp";
          }
          if (!ext) ext = ".gif";
          const savePath = path.join(tempDir, `fallback-download${ext}`);
          await fsPromises.writeFile(savePath, buffer);
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

          const buffer = await readCappedBody(mediaResp);
          assertBufferIsMedia(buffer);

          let ext = path.extname(new URL(mediaUrl).pathname);
          if (!ext || ext.length > 5) {
            const cType = mediaResp.headers.get("content-type") || "";
            if (cType.includes("video/mp4")) ext = ".mp4";
            else if (cType.includes("image/gif")) ext = ".gif";
            else if (cType.includes("image/webp")) ext = ".webp";
          }
          if (!ext) ext = ".gif";

          const savePath = path.join(tempDir, `fallback-download${ext}`);
          await fsPromises.writeFile(savePath, buffer);
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
      for (const originalPath of downloadedFiles) {
        if (foundValid) break;

        const detectedKind = await detectFileMediaKind(originalPath).catch(() => null);
        if (!detectedKind) {
          continue;
        }

        const stats = await fsPromises.stat(originalPath);
        if (stats.size > MAX_DOWNLOAD_SIZE) {
          continue;
        }

        const ext = `.${detectedKind}`;
        const isMp4 = detectedKind === "mp4";

        const downloadedPath = path.join(
          path.dirname(originalPath),
          `${path.basename(originalPath, path.extname(originalPath))}${ext}`,
        );
        if (downloadedPath !== originalPath) {
          await fsPromises.rename(originalPath, downloadedPath);
        }

        let finalFilePath = downloadedPath;
        let finalExt = ext;
        let finalMimeType = isMp4 ? "video/mp4" : EXTENSION_MIME_MAP[ext];
        let reEncoded = false;

        if (!isMp4) {
          try {
            await assertWithinPixelBudget(downloadedPath, detectedKind);
          } catch (e) {
            console.warn(`Rejecting ${downloadedPath}: ${toError(e).message}`);
            continue;
          }
        }

        if (finalExt === ".gif" || isMp4) {
          const webpPath = downloadedPath.replace(new RegExp(`${ext}$`, "i"), ".webp");
          let conversionSuccess = false;

          if (isMp4) {
            try {
              await execFilePromise(
                "ffmpeg",
                [...FFMPEG_INPUT_ARGS, downloadedPath, ...FFMPEG_WEBP_ARGS, webpPath],
                {
                  timeout: config.MEDIA_TIMEOUT_MS,
                },
              );
              await fsPromises.access(webpPath);
              conversionSuccess = true;
            } catch (e) {
              console.warn(`ffmpeg conversion failed for ${downloadedPath}: ${toError(e).message}`);
            }
          }

          if (!conversionSuccess) {
            try {
              await runMagick([
                pinnedInput(downloadedPath, detectedKind),
                "-coalesce",
                "-strip",
                "-quality",
                "80",
                `WEBP:${webpPath}`,
              ]);
              await fsPromises.access(webpPath);
              conversionSuccess = true;
            } catch (errConvert) {
              console.warn(
                `ImageMagick conversion failed for ${downloadedPath}: ${toError(errConvert).message}`,
              );
            }
          }

          if (conversionSuccess) {
            finalFilePath = webpPath;
            finalExt = ".webp";
            finalMimeType = "image/webp";
            reEncoded = true;
          } else if (isMp4) {
            const gifPath = downloadedPath.replace(new RegExp(`${ext}$`, "i"), ".gif");
            try {
              await execFilePromise(
                "ffmpeg",
                [...FFMPEG_INPUT_ARGS, downloadedPath, "-map_metadata", "-1", gifPath],
                { timeout: config.MEDIA_TIMEOUT_MS },
              );
              await fsPromises.access(gifPath);

              finalFilePath = gifPath;
              finalExt = ".gif";
              finalMimeType = "image/gif";
              reEncoded = true;
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

        let validatedKind: MediaKind;
        try {
          validatedKind = await assertValidImage(finalFilePath, ["gif", "webp"]);
        } catch (e) {
          console.warn(`Rejecting ${finalFilePath}: ${toError(e).message}`);
          continue;
        }

        if (!reEncoded) {
          try {
            await sanitizeInPlace(finalFilePath, validatedKind);
          } catch (e) {
            console.warn(`Rejecting ${finalFilePath}, sanitize failed: ${toError(e).message}`);
            continue;
          }
        }

        const finalStats = await fsPromises.stat(finalFilePath);
        if (finalStats.size > MAX_DOWNLOAD_SIZE) {
          continue;
        }

        const uniqueName = `${Date.now()}-${nanoid(6)}${finalExt}`;
        const savePath = path.join(config.UPLOAD_DIR, uniqueName);

        await fsPromises.copyFile(finalFilePath, savePath);

        const slug = nanoid(10);
        const originalName = path.basename(originalPath);

        await addGif({
          slug,
          filename: uniqueName,
          originalName,
          mimeType: finalMimeType,
          sizeBytes: finalStats.size,
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
