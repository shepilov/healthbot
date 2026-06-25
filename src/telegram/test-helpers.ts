import type { Bot, RawApi, Transformer } from "grammy";

export interface TelegramApiCall {
  readonly method: string;
  readonly payload: unknown;
}

export function installTelegramApiMock(bot: Bot): TelegramApiCall[] {
  const calls: TelegramApiCall[] = [];
  const transformer: Transformer<RawApi> = async (_prev, method, payload) => {
    calls.push({
      method: String(method),
      payload,
    });

    return {
      ok: true,
      result: true,
    } as never;
  };

  bot.api.config.use(transformer);

  return calls;
}
