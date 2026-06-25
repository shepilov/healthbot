import type { Bot } from "grammy";
import type { Logger } from "pino";

import type { AppConfig } from "./config.js";
import { configureTelegramCommands } from "./telegram/adapter.js";
import {
  startWebhookServer,
  type RunningWebhookServer,
} from "./webhook-server.js";

const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export interface BotRuntime {
  stop(): Promise<void>;
}

export async function startBotRuntime(
  config: AppConfig,
  bot: Bot,
  logger: Logger,
): Promise<BotRuntime> {
  await configureTelegramCommands(bot);

  if (config.BOT_MODE === "webhook") {
    return startWebhookRuntime(config, bot, logger);
  }

  return startLongPollingRuntime(bot, logger);
}

async function startLongPollingRuntime(
  bot: Bot,
  logger: Logger,
): Promise<BotRuntime> {
  logger.info("starting telegram bot in long-polling mode");
  await bot.api.deleteWebhook();

  void bot
    .start({
      allowed_updates: ALLOWED_UPDATES,
    })
    .catch((error: unknown) => {
      logger.fatal({ err: error }, "telegram bot stopped unexpectedly");
      process.exitCode = 1;
    });

  return {
    async stop() {
      bot.stop();
    },
  };
}

async function startWebhookRuntime(
  config: AppConfig,
  bot: Bot,
  logger: Logger,
): Promise<BotRuntime> {
  if (config.WEBHOOK_URL === undefined) {
    throw new Error("WEBHOOK_URL is required when BOT_MODE=webhook");
  }

  logger.info(
    {
      healthcheckPath: config.HEALTHCHECK_PATH,
      host: config.HOST,
      port: config.PORT,
      webhookUrl: config.WEBHOOK_URL,
    },
    "starting telegram bot in webhook mode",
  );

  const server = await startWebhookServer({
    bot,
    healthcheckPath: config.HEALTHCHECK_PATH,
    host: config.HOST,
    logger,
    port: config.PORT,
    ...(config.WEBHOOK_SECRET === undefined
      ? {}
      : { webhookSecret: config.WEBHOOK_SECRET }),
    webhookUrl: config.WEBHOOK_URL,
  });

  try {
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      allowed_updates: ALLOWED_UPDATES,
      ...(config.WEBHOOK_SECRET === undefined
        ? {}
        : { secret_token: config.WEBHOOK_SECRET }),
    });
  } catch (error) {
    await server.close();
    throw error;
  }

  return {
    async stop() {
      await stopWebhookRuntime(server, logger);
    },
  };
}

async function stopWebhookRuntime(
  server: RunningWebhookServer,
  logger: Logger,
): Promise<void> {
  logger.info("stopping webhook server");
  await server.close();
}
