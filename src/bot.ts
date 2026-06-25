import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Logger } from "pino";

import { createInMemoryHealthBotApp, type HealthBotApp } from "./app.js";
import { registerTelegramHandlers } from "./telegram/adapter.js";

export interface HealthBotDependencies {
  app?: HealthBotApp;
  botInfo?: UserFromGetMe;
  logger: Logger;
  token: string;
}

export function createHealthBot({
  app = createInMemoryHealthBotApp(),
  botInfo,
  logger,
  token,
}: HealthBotDependencies): Bot {
  const bot = new Bot(
    token,
    botInfo === undefined
      ? undefined
      : {
          botInfo,
        },
  );

  registerTelegramHandlers(bot, {
    activeFlowStore: app.activeFlowStore,
    eventStore: app.eventStore,
    logger,
    questionnaireEngine: app.questionnaireEngine,
  });

  bot.catch((error) => {
    logger.error(
      {
        err: error.error,
        updateId: error.ctx.update.update_id,
      },
      "telegram update failed",
    );
  });

  return bot;
}
