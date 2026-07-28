import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import config from "./config.ts";
import router from "./routes.ts";
import { logRequest, sanitize } from "./logger.ts";

const app = express();

app.set("trust proxy", config.TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cookieParser());
app.use(config.MOUNT_PATH, express.json());

app.use((req, _res, next) => {
  logRequest(req);
  next();
});

if (fs.existsSync(config.FRONTEND_DIST)) {
  app.use(
    config.MOUNT_PATH,
    express.static(config.FRONTEND_DIST, {
      index: false,
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.match(/\.(gif|webp|jpg|jpeg|png|svg|ico|woff|woff2|ttf|eot)$/i)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.match(/\.(js|css)$/i)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
}

app.use(config.MOUNT_PATH, router);

let cachedShell: string | null = null;

function renderShell(): string | null {
  if (cachedShell !== null) {
    return cachedShell;
  }
  const indexPath = path.join(config.FRONTEND_DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  const html = fs.readFileSync(indexPath, "utf8");
  const runtime =
    `<base href="${config.BASE_PATH}/" />` +
    `<script>window.__BASE__=${JSON.stringify(config.BASE_PATH)};` +
    `window.__DEFAULT_CATEGORY__=${JSON.stringify(config.DEFAULT_CATEGORY_ID)};</script>`;
  cachedShell = html.includes("</head>")
    ? html.replace("</head>", `${runtime}</head>`)
    : runtime + html;
  return cachedShell;
}

function serveFrontend(_req: Request, res: Response) {
  const shell = renderShell();
  if (shell === null) {
    return res.status(404).send("Frontend build not found.");
  }
  res.type("html");
  return res.send(shell);
}

app.get(config.MOUNT_PATH, serveFrontend);

app.get(`${config.BASE_PATH}/*rest`, (req, res, next) => {
  const rest = Array.isArray(req.params.rest) ? req.params.rest.join("/") : req.params.rest || "";
  const relativePath = `/${rest}`;
  if (relativePath.startsWith("/api") || relativePath.startsWith("/share")) {
    return next();
  }
  if (relativePath.startsWith("/public")) {
    return serveFrontend(req, res);
  }
  return res.status(404).send("Not Found");
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const candidate = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  const rawStatus = candidate?.status ?? candidate?.statusCode;
  const status =
    typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  if (status >= 500) {
    console.error(err);
    res.status(status).json({ error: "Internal server error." });
    return;
  }

  console.warn(`[request] ${status}: ${sanitize(candidate?.message ?? "client error")}`);
  res.status(status).json({
    error: typeof candidate?.message === "string" ? candidate.message : "Bad request.",
  });
});

export default app;
