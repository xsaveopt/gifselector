import app from "./app.ts";
import config from "./config.ts";
import { processStats } from "./stats.ts";
import { startDiscordBot, stopDiscordBot } from "../discord/discord.ts";

const port = process.env.PORT || 3000;

if (config.ENABLE_FILE_LOGGING) {
  setInterval(
    () => {
      processStats();
    },
    60 * 60 * 1000,
  );

  processStats();
}

const server = app.listen(port, () => {
  console.log(`gifselector backend running on port ${port}`);
});

startDiscordBot();

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  stopDiscordBot().finally(() => {
    server.close(() => {
      process.exit(0);
    });
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.once(signal, () => shutdown(signal));
});
