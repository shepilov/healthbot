import "dotenv/config";

import { createHealthBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { startBotRuntime, type BotRuntime } from "./runtime.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const bot = createHealthBot({
  logger,
  token: config.BOT_TOKEN,
});
let runtime: BotRuntime | undefined;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, "received shutdown signal");

  try {
    await runtime?.stop();
  } catch (error) {
    logger.error({ err: error }, "failed to stop bot runtime cleanly");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  runtime = await startBotRuntime(config, bot, logger);
} catch (error) {
  logger.fatal({ err: error }, "failed to start bot runtime");
  process.exitCode = 1;
}
