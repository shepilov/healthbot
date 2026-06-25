import "dotenv/config";

import { createHealthBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const bot = createHealthBot({
  logger,
  token: config.BOT_TOKEN,
});

process.once("SIGINT", () => {
  logger.info("received SIGINT, stopping bot");
  bot.stop();
});

process.once("SIGTERM", () => {
  logger.info("received SIGTERM, stopping bot");
  bot.stop();
});

logger.info("starting telegram bot in long-polling mode");

try {
  await bot.start({
    allowed_updates: ["message", "callback_query"],
  });
} catch (error) {
  logger.fatal({ err: error }, "telegram bot stopped unexpectedly");
  process.exitCode = 1;
}
