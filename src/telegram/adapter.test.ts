import pino from "pino";
import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";

import { createInMemoryHealthBotApp } from "../app.js";
import { createHealthBot } from "../bot.js";
import type { QuestionnaireDefinition } from "../questionnaire/index.js";
import type { TelegramApiCall } from "./test-helpers.js";
import { installTelegramApiMock } from "./test-helpers.js";

const testBotInfo: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: "Healthbot",
  username: "healthbot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

describe("Telegram adapter", () => {
  it("starts profile intake from /start when profile is missing", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 100, type: "private", first_name: "User" },
        from: { id: 200, is_bot: false, first_name: "User" },
        text: "/start",
        entities: [{ offset: 0, length: 6, type: "bot_command" }],
      },
    } satisfies Update);

    await expect(app.eventStore.loadByUser("200")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
    ]);
    expect(findMethod(calls, "sendMessage")?.payload).toMatchObject({
      chat_id: 100,
      text: expect.stringContaining("Возраст"),
    });
  });

  it("shows check-in commands from /start when profile is complete", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "profile",
          questions: [
            {
              id: "age",
              text: "Возраст",
              type: "number",
            },
          ],
        },
      ],
    });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/start"));
    await bot.handleUpdate(messageUpdate(2, "35"));
    calls.length = 0;

    await bot.handleUpdate(messageUpdate(3, "/start"));

    expect(findMethod(calls, "sendMessage")?.payload).toMatchObject({
      text: expect.stringContaining("/daily"),
    });
  });

  it("answers callback queries and records scale answers", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/daily"));
    calls.length = 0;

    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: "callback-1",
        chat_instance: "chat-instance",
        data: "q:scale:7",
        from: { id: 200, is_bot: false, first_name: "User" },
        message: {
          message_id: 10,
          date: 1,
          chat: { id: 100, type: "private", first_name: "User" },
        },
      },
    } satisfies Update);

    expect(calls.map((call) => call.method)).toContain("answerCallbackQuery");
    expect(findMessageContaining(calls, "Ваш ответ: 7")?.payload).toMatchObject(
      {
        text: expect.stringContaining("Ваш ответ: 7"),
      },
    );
    await expect(app.eventStore.loadByUser("200")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      {
        type: "AnswerRecorded",
        payload: {
          answer: 7,
        },
      },
      { type: "QuestionnaireCompleted" },
    ]);
  });

  it("shows selected single-choice labels in a summary message", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "profile",
          questions: [
            {
              id: "skin_type",
              text: "Тип кожи",
              type: "single",
              options: [
                { id: "dry", label: "Сухая" },
                { id: "normal", label: "Нормальная" },
              ],
            },
          ],
        },
      ],
    });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/profile"));
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(2, "q:single:normal"));

    expect(
      findMessageContaining(calls, "Ваш ответ: Нормальная")?.payload,
    ).toMatchObject({
      text: expect.stringContaining("Ваш ответ: Нормальная"),
    });
  });

  it("sends the next question as a new message after an inline answer", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "profile",
          questions: [
            {
              id: "skin_type",
              text: "Тип кожи",
              type: "single",
              options: [
                { id: "dry", label: "Сухая" },
                { id: "normal", label: "Нормальная" },
              ],
            },
            {
              id: "country",
              text: "Страна проживания",
              type: "text",
            },
          ],
        },
      ],
    });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/profile"));
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(2, "q:single:normal"));

    expect(
      findMessageContaining(calls, "Ваш ответ: Нормальная")?.payload,
    ).toBeDefined();
    expect(
      findMessageContaining(calls, "Страна проживания")?.payload,
    ).toBeDefined();
    expect(findEditContaining(calls, "Страна проживания")).toBeUndefined();
  });

  it("keeps one summary message per multi-select question", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "profile",
          questions: [
            {
              id: "main_goal",
              text: "Что беспокоит?",
              type: "multi",
              options: [
                { id: "skin", label: "Кожа" },
                { id: "sleep", label: "Сон" },
              ],
            },
          ],
        },
      ],
    });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/profile"));
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(2, "q:multi:skin"));

    expect(
      findMessageContaining(calls, "Вы выбрали: Кожа")?.payload,
    ).toMatchObject({
      text: expect.stringContaining("Вы выбрали: Кожа"),
    });

    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(3, "q:multi:sleep"));

    expect(
      findEditContaining(calls, "Вы выбрали: Кожа, Сон")?.payload,
    ).toMatchObject({
      text: expect.stringContaining("Вы выбрали: Кожа, Сон"),
    });
    expect(
      findMessageContaining(calls, "Вы выбрали: Кожа, Сон"),
    ).toBeUndefined();
  });

  it("cancels an active questionnaire", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/daily"));
    await bot.handleUpdate(messageUpdate(2, "/cancel"));

    await expect(app.activeFlowStore.get("200")).resolves.toBeUndefined();
    await expect(app.eventStore.loadByUser("200")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      { type: "QuestionnaireCancelled" },
    ]);
    expect(calls.at(-1)?.payload).toMatchObject({
      text: expect.stringContaining("отменена"),
    });
  });

  it("records only Telegram photo identifiers for photo answers", async () => {
    const questionnaires: readonly QuestionnaireDefinition[] = [
      {
        id: "profile",
        questions: [
          {
            id: "face_photo",
            text: "Фото лица",
            type: "photo",
          },
        ],
      },
    ];
    const app = createInMemoryHealthBotApp({ questionnaires });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/profile"));
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 100, type: "private", first_name: "User" },
        from: { id: 200, is_bot: false, first_name: "User" },
        photo: [
          {
            file_id: "small-file",
            file_unique_id: "small-unique",
            width: 10,
            height: 10,
          },
          {
            file_id: "large-file",
            file_unique_id: "large-unique",
            width: 100,
            height: 100,
          },
        ],
      },
    } satisfies Update);

    await expect(app.eventStore.loadByUser("200")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      {
        type: "PhotoReceived",
        payload: {
          fileId: "large-file",
          fileUniqueId: "large-unique",
        },
      },
      {
        type: "AnswerRecorded",
        payload: {
          answer: {
            fileId: "large-file",
            fileUniqueId: "large-unique",
          },
        },
      },
      { type: "QuestionnaireCompleted" },
    ]);
  });
});

function messageUpdate(updateId: number, text: string): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: 100, type: "private", first_name: "User" },
      from: { id: 200, is_bot: false, first_name: "User" },
      text,
      ...(text.startsWith("/")
        ? {
            entities: [
              { offset: 0, length: text.length, type: "bot_command" as const },
            ],
          }
        : {}),
    },
  } satisfies Update;
}

function callbackUpdate(updateId: number, data: string): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      chat_instance: "chat-instance",
      data,
      from: { id: 200, is_bot: false, first_name: "User" },
      message: {
        message_id: updateId,
        date: 1,
        chat: { id: 100, type: "private", first_name: "User" },
      },
    },
  } satisfies Update;
}

function findMethod(calls: readonly TelegramApiCall[], method: string) {
  return calls.find((call) => call.method === method);
}

function findMessageContaining(
  calls: readonly TelegramApiCall[],
  text: string,
) {
  return calls.find(
    (call) =>
      call.method === "sendMessage" &&
      typeof call.payload === "object" &&
      call.payload !== null &&
      "text" in call.payload &&
      typeof call.payload.text === "string" &&
      call.payload.text.includes(text),
  );
}

function findEditContaining(calls: readonly TelegramApiCall[], text: string) {
  return calls.find(
    (call) =>
      call.method === "editMessageText" &&
      typeof call.payload === "object" &&
      call.payload !== null &&
      "text" in call.payload &&
      typeof call.payload.text === "string" &&
      call.payload.text.includes(text),
  );
}
