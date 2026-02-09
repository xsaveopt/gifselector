const fs = require("fs");
const config = require("./config");

function logRequest(req) {
  const timestamp = new Date().toISOString();
  const clientIp = req.ip || req.connection?.remoteAddress || "unknown-ip";
  const referer = req.get("referer") || req.get("referrer") || "no-referer";
  const userAgent = req.get("user-agent") || "no-user-agent";

  const logMessage = `[${timestamp}] ${req.method} ${req.originalUrl} from ${clientIp} referer=${referer} ua=${userAgent}`;

  // Console logging (keeping current way)
  console.log(logMessage);

  if (config.ENABLE_FILE_LOGGING) {
    try {
      fs.appendFileSync(config.LOG_FILE_PATH, logMessage + "\n");
    } catch (err) {
      console.error("Failed to write to log file", err);
    }
  }
}

module.exports = {
  logRequest,
};
