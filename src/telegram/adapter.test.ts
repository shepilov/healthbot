import pino from "pino";
import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";

import { createInMemoryHealthBotApp } from "../app.js";
import { createHealthBot } from "../bot.js";
import { createDomainEvent } from "../domain/index.js";
import type { QuestionnaireDefinition } from "../questionnaire/index.js";
import { configureTelegramCommands, telegramBotCommands } from "./adapter.js";
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
  it("declares the primary Telegram command menu", () => {
    expect(telegramBotCommands.map((command) => command.command)).toEqual([
      "start",
      "help",
      "profile",
      "daily",
      "weekly",
      "monthly",
      "status",
      "cancel",
    ]);
  });

  it("registers Telegram commands through the Bot API", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await configureTelegramCommands(bot);

    expect(findMethod(calls, "setMyCommands")?.payload).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ command: "help" }),
        expect.objectContaining({ command: "status" }),
      ]),
    });
  });

  it("shows help text from /help", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/help"));

    expect(findMessageContaining(calls, "Помощь")?.payload).toMatchObject({
      text: expect.stringContaining("/status"),
    });
    expect(findMessageContaining(calls, "Помощь")?.payload).toMatchObject({
      text: expect.stringContaining("не дает медицинских советов"),
    });
  });

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
    expect(findMethod(calls, "sendMessage")?.payload).toMatchObject({
      text: expect.stringContaining("Вопрос 1 из"),
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

    const startMessage = findMethod(calls, "sendMessage")?.payload;

    expect(startMessage).toMatchObject({
      text: expect.stringContaining("/daily"),
    });
    expect(startMessage).toMatchObject({
      text: expect.stringContaining("/status"),
    });
  });

  it("reports profile and latest check-ins from /status", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await app.eventStore.append([
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 8, 0, 0),
        type: "QuestionnaireCompleted",
        userId: "200",
        payload: {
          questionnaireId: "profile",
        },
      }),
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 9, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "200",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 18, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "200",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 19, 30, 0),
        type: "PeriodCheckInCompleted",
        userId: "200",
        payload: {
          period: "weekly",
          periodKey: "2026-W26",
          questionnaireId: "weekly",
        },
      }),
    ]);

    await bot.handleUpdate(messageUpdate(1, "/status"));

    const statusMessage = findMessageContaining(calls, "Последние чек-ины");

    expect(statusMessage?.payload).toMatchObject({
      text: expect.stringContaining("Профиль: заполнен"),
    });
    expect(statusMessage?.payload).toMatchObject({
      text: expect.stringContaining(
        "Ежедневный: 2026-06-25, обновлено 2026-06-25 18:00",
      ),
    });
    expect(statusMessage?.payload).toMatchObject({
      text: expect.stringContaining(
        "Еженедельный: 2026-W26, обновлено 2026-06-25 19:30",
      ),
    });
    expect(statusMessage?.payload).toMatchObject({
      text: expect.stringContaining("Ежемесячный: нет"),
    });
    expect(statusMessage?.payload).not.toMatchObject({
      text: expect.stringContaining("2026-06-25 09:00"),
    });
    await expect(app.eventStore.loadByUser("200")).resolves.toHaveLength(4);
  });

  it("asks for confirmation before updating an already completed daily check-in", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "daily",
          period: "daily",
          questions: [
            {
              id: "mood",
              text: "Настроение",
              type: "scale_1_10",
            },
          ],
        },
      ],
    });
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      clock: () => new Date(2026, 5, 25, 12, 0, 0),
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await app.eventStore.append(
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 9, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "200",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
    );

    await bot.handleUpdate(messageUpdate(1, "/daily"));

    expect(findMessageContaining(calls, "уже заполнен")?.payload).toMatchObject(
      {
        text: expect.stringContaining("Обновить ответы"),
      },
    );
    await expect(app.activeFlowStore.get("200")).resolves.toBeUndefined();

    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(2, "q:start_confirm:daily"));

    expect(findMessageContaining(calls, "Настроение")?.payload).toBeDefined();
    await expect(app.activeFlowStore.get("200")).resolves.toMatchObject({
      currentQuestionId: "mood",
    });
  });

  it("moves back with inline navigation", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "daily",
          questions: [
            {
              id: "mood",
              text: "Настроение",
              type: "scale_1_10",
            },
            {
              id: "energy",
              text: "Энергия",
              type: "scale_1_10",
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

    await bot.handleUpdate(messageUpdate(1, "/daily"));
    await bot.handleUpdate(callbackUpdate(2, "q:scale:7"));
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(3, "q:back"));

    expect(findEditContaining(calls, "Настроение")?.payload).toBeDefined();
    await expect(app.activeFlowStore.get("200")).resolves.toMatchObject({
      answers: {},
      currentQuestionId: "mood",
    });
  });

  it("skips optional lab panels with inline navigation", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/monthly"));
    await bot.handleUpdate(callbackUpdate(2, "q:skip"));

    await expect(app.eventStore.loadByUser("200")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            answer: expect.objectContaining({
              ferritin: null,
              vitamin_d: null,
            }),
            questionId: "monthly_labs",
          }),
          type: "AnswerRecorded",
        }),
      ]),
    );
  });

  it("answers callback queries and records scale answers", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "daily",
          questions: [
            {
              id: "mood",
              text: "Настроение",
              type: "scale_1_10",
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

  it("shows a completion recap with option labels", async () => {
    const app = createInMemoryHealthBotApp({
      questionnaires: [
        {
          id: "profile",
          title: "Профиль",
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
      findMessageContaining(calls, "Итоги: Профиль")?.payload,
    ).toMatchObject({
      text: expect.stringContaining("Тип кожи: Нормальная"),
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
              id: "notes",
              text: "Комментарий",
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
    expect(findMessageContaining(calls, "Комментарий")?.payload).toBeDefined();
    expect(findEditContaining(calls, "Комментарий")).toBeUndefined();
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

  it("records only Telegram file_id for photo answers", async () => {
    const questionnaires: readonly QuestionnaireDefinition[] = [
      {
        id: "weekly",
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

    await bot.handleUpdate(messageUpdate(1, "/weekly"));
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

    const events = await app.eventStore.loadByUser("200");

    expect(events).toMatchObject([
      { type: "QuestionnaireStarted" },
      {
        type: "PhotoReceived",
        payload: {
          fileId: "large-file",
        },
      },
      {
        type: "AnswerRecorded",
        payload: {
          answer: {
            fileId: "large-file",
          },
        },
      },
      { type: "QuestionnaireCompleted" },
    ]);
    expect(
      events.find((event) => event.type === "PhotoReceived")?.payload,
    ).not.toHaveProperty("fileUniqueId");
    expect(
      events.find((event) => event.type === "AnswerRecorded")?.payload,
    ).toMatchObject({
      answer: expect.not.objectContaining({
        fileUniqueId: expect.any(String),
      }),
    });
  });

  it("asks for a photo or cancellation when text is sent at a photo step", async () => {
    const questionnaires: readonly QuestionnaireDefinition[] = [
      {
        id: "weekly",
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
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/weekly"));
    calls.length = 0;
    await bot.handleUpdate(messageUpdate(2, "не фото"));

    expect(
      findMessageContaining(calls, "Загрузите фото или отмените")?.payload,
    ).toBeDefined();
    await expect(app.activeFlowStore.get("200")).resolves.toMatchObject({
      currentQuestionId: "face_photo",
    });
  });

  it("parses monthly lab text with aliases and skipped values", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/monthly"));
    await bot.handleUpdate(
      messageUpdate(2, "Ферритин=42, ТТГ=2.1, vitamin_d=пропустить"),
    );

    const events = await app.eventStore.loadByUser("200");

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            answer: expect.objectContaining({
              ferritin: 42,
              glucose: null,
              tsh: 2.1,
              vitamin_d: null,
            }),
            questionId: "monthly_labs",
          }),
          type: "AnswerRecorded",
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            period: "monthly",
            questionnaireId: "monthly",
          }),
          type: "PeriodCheckInCompleted",
        }),
      ]),
    );
  });

  it("shows a retry prompt for invalid monthly lab values", async () => {
    const app = createInMemoryHealthBotApp();
    const bot = createHealthBot({
      app,
      botInfo: testBotInfo,
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    });
    const calls = installTelegramApiMock(bot);

    await bot.handleUpdate(messageUpdate(1, "/monthly"));
    calls.length = 0;
    await bot.handleUpdate(messageUpdate(2, "Ферритин=abc"));

    expect(
      findMessageContaining(calls, "Не получилось записать ответ")?.payload,
    ).toMatchObject({
      text: expect.stringContaining("Ферритин: Введите число"),
    });
    await expect(app.activeFlowStore.get("200")).resolves.toMatchObject({
      currentQuestionId: "monthly_labs",
    });
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
