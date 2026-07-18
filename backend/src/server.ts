import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import config from "./config.ts";
import router from "./routes.ts";
import { logRequest } from "./logger.ts";
import { processStats } from "./stats.ts";

const app = express();
const port = process.env.PORT || 3000;

app.set("trust proxy", config.TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cookieParser());
app.use(config.BASE_PATH, express.json());

app.use((req, _res, next) => {
  logRequest(req);
  next();
});

if (config.ENABLE_FILE_LOGGING) {
  setInterval(
    () => {
      processStats();
    },
    60 * 60 * 1000,
  );

  processStats();
}

if (fs.existsSync(config.FRONTEND_DIST)) {
  app.use(
    config.BASE_PATH,
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

app.use(config.BASE_PATH, router);

function serveFrontend(_req: Request, res: Response) {
  if (!fs.existsSync(config.FRONTEND_DIST)) {
    return res.status(404).send("Frontend build not found.");
  }
  return res.sendFile(path.join(config.FRONTEND_DIST, "index.html"));
}

app.get(config.BASE_PATH, serveFrontend);

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
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

const server = app.listen(port, () => {
  console.log(`gifselector backend running on port ${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    process.exit(0);
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.once(signal, () => shutdown(signal));
});
