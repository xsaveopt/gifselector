const fs = require("fs");
const config = require("./config");

function processStats() {
  if (!config.ENABLE_FILE_LOGGING) return;
  if (!fs.existsSync(config.LOG_FILE_PATH)) return;

  try {
    const data = fs.readFileSync(config.LOG_FILE_PATH, "utf8");
    const lines = data.split("\n").filter((line) => line.trim() !== "");

    const ipCounts = {};
    const uaCounts = {};

    lines.forEach((line) => {
      // Format: [timestamp] METHOD url from IP referer=... ua=...
      const ipMatch = line.match(/from (.*?) referer=/);
      const uaMatch = line.match(/ua=(.*)$/);

      if (ipMatch && ipMatch[1]) {
        const ip = ipMatch[1].trim();
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }

      if (uaMatch && uaMatch[1]) {
        const ua = uaMatch[1].trim();
        uaCounts[ua] = (uaCounts[ua] || 0) + 1;
      }
    });

    const sortedIps = Object.entries(ipCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ip, count]) => `${ip}: ${count}`);

    const sortedUas = Object.entries(uaCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ua, count]) => `${ua}: ${count}`);

    const output = [
      `Statistics generated at ${new Date().toISOString()}`,
      "",
      "=== IP Addresses Ranked ===",
      ...sortedIps,
      "",
      "=== Browser Agents Ranked ===",
      ...sortedUas,
    ].join("\n");

    fs.writeFileSync(config.STATS_FILE_PATH, output);
  } catch (err) {
    console.error("Error processing log statistics:", err);
  }
}

module.exports = {
  processStats,
};
