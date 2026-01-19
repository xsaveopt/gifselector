const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const config = require('./config');
const routes = require('./routes');

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cookieParser());
app.use(config.BASE_PATH, express.json());

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown-ip';
  const referer = req.get('referer') || req.get('referrer') || 'no-referer';
  const userAgent = req.get('user-agent') || 'no-user-agent';
  console.log(
    `[${timestamp}] ${req.method} ${req.originalUrl} from ${clientIp} referer=${referer} ua=${userAgent}`
  );
  next();
});

if (fs.existsSync(config.FRONTEND_DIST)) {
  app.use(
    config.BASE_PATH,
    express.static(config.FRONTEND_DIST, {
      index: false
    })
  );
}

app.use(config.BASE_PATH, routes);

function serveFrontend(req, res) {
  if (!fs.existsSync(config.FRONTEND_DIST)) {
    return res.status(404).send('Frontend build not found.');
  }
  return res.sendFile(path.join(config.FRONTEND_DIST, 'index.html'));
}

app.get(config.BASE_PATH, serveFrontend);

app.get(`${config.BASE_PATH}/:rest(*)`, (req, res, next) => {
  const relativePath = `/${req.params.rest || ''}`;
  if (relativePath.startsWith('/api') || relativePath.startsWith('/share')) {
    return next();
  }
  return res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
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

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.once(signal, () => shutdown(signal));
});
