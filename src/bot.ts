import { Bot } from "grammy";
import type { Logger } from "pino";

export interface HealthBotDependencies {
  logger: Logger;
  token: string;
}

export function createHealthBot({ logger, token }: HealthBotDependencies): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    logger.info({ telegramUserId: ctx.from?.id }, "telegram user started bot");

    await ctx.reply(
      [
        "Здравствуйте! Я помогу вести трекинг самочувствия, кожи и привычек.",
        "",
        "Профиль и чек-ины будут добавлены в следующих задачах.",
        "Пока можно проверить запуск командой /status.",
      ].join("\n"),
    );
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(
      "Бот запущен. Профиль и чек-ины появятся в следующих этапах MVP.",
    );
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
