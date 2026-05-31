const express = require("express");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const config = require("./config");
const routes = require("./routes");
const logger = require("./logger");
const stats = require("./stats");

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

app.use((req, res, next) => {
  logger.logRequest(req);
  next();
});

if (config.ENABLE_FILE_LOGGING) {
  setInterval(
    () => {
      stats.processStats();
    },
    60 * 60 * 1000,
  );

  stats.processStats();
}

if (fs.existsSync(config.FRONTEND_DIST)) {
  app.use(
    config.BASE_PATH,
    express.static(config.FRONTEND_DIST, {
      index: false,
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, filePath) => {
        if (
          filePath.match(
            /\.(gif|webp|jpg|jpeg|png|svg|ico|woff|woff2|ttf|eot)$/i,
          )
        ) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.match(/\.(js|css)$/i)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
}

app.use(config.BASE_PATH, routes);

function serveFrontend(req, res) {
  if (!fs.existsSync(config.FRONTEND_DIST)) {
    return res.status(404).send("Frontend build not found.");
  }
  return res.sendFile(path.join(config.FRONTEND_DIST, "index.html"));
}

app.get(config.BASE_PATH, serveFrontend);

app.get(`${config.BASE_PATH}/*rest`, (req, res, next) => {
  const rest = Array.isArray(req.params.rest)
    ? req.params.rest.join("/")
    : req.params.rest || "";
  const relativePath = `/${rest}`;
  if (relativePath.startsWith("/api") || relativePath.startsWith("/share")) {
    return next();
  }
  if (relativePath.startsWith("/public")) {
    return serveFrontend(req, res);
  }
  return res.status(404).send("Not Found");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

const server = app.listen(port, () => {
  console.log(`gifselector backend running on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    process.exit(0);
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.once(signal, () => shutdown(signal));
});
