import type { Bot, RawApi, Transformer } from "grammy";

export interface TelegramApiCall {
  readonly method: string;
  readonly payload: unknown;
}

export function installTelegramApiMock(bot: Bot): TelegramApiCall[] {
  const calls: TelegramApiCall[] = [];
  let nextMessageId = 1_000;
  const transformer: Transformer<RawApi> = async (_prev, method, payload) => {
    calls.push({
      method: String(method),
      payload,
    });

    if (method === "sendMessage") {
      const messageId = nextMessageId;
      nextMessageId += 1;

      return {
        ok: true,
        result: {
          message_id: messageId,
          date: 1,
          chat: {
            id: getPayloadChatId(payload),
            type: "private",
            first_name: "User",
          },
          text: getPayloadText(payload),
        },
      } as never;
    }

    return {
      ok: true,
      result: true,
    } as never;
  };

  bot.api.config.use(transformer);

  return calls;
}

function getPayloadChatId(payload: unknown): number {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "chat_id" in payload &&
    typeof payload.chat_id === "number"
  ) {
    return payload.chat_id;
  }

  return 100;
}

function getPayloadText(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "text" in payload &&
    typeof payload.text === "string"
  ) {
    return payload.text;
  }

  return "";
}
