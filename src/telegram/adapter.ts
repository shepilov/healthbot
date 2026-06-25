import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { Logger } from "pino";

import {
  DAILY_QUESTIONNAIRE_ID,
  MONTHLY_QUESTIONNAIRE_ID,
  PROFILE_QUESTIONNAIRE_ID,
  WEEKLY_QUESTIONNAIRE_ID,
} from "../questionnaire/default-questionnaires.js";
import type {
  ActiveFlowStore,
  ActiveQuestionnaireFlow,
  LabPanelQuestion,
  QuestionDefinition,
  QuestionnaireAnswerInput,
  QuestionnaireEngine,
  QuestionnaireEngineResult,
} from "../questionnaire/index.js";
import { getQuestionnaireStatus } from "../status/questionnaire-status.js";
import type { EventStore, QuestionnaireId, UserId } from "../domain/index.js";

const CALLBACK_PREFIX = "q";

export interface TelegramAdapterDependencies {
  readonly activeFlowStore: ActiveFlowStore;
  readonly eventStore: Pick<EventStore, "loadByUser">;
  readonly logger: Logger;
  readonly questionnaireEngine: QuestionnaireEngine;
}

interface TelegramIdentity {
  readonly chatId: string;
  readonly telegramChatId: number;
  readonly userId: UserId;
}

interface RenderedQuestion {
  readonly keyboard?: InlineKeyboard;
  readonly text: string;
}

export function registerTelegramHandlers(
  bot: Bot,
  dependencies: TelegramAdapterDependencies,
): void {
  bot.command("start", async (ctx) => handleStart(ctx, dependencies));
  bot.command("profile", async (ctx) =>
    startQuestionnaire(ctx, dependencies, PROFILE_QUESTIONNAIRE_ID),
  );
  bot.command("daily", async (ctx) =>
    startQuestionnaire(ctx, dependencies, DAILY_QUESTIONNAIRE_ID),
  );
  bot.command("weekly", async (ctx) =>
    startQuestionnaire(ctx, dependencies, WEEKLY_QUESTIONNAIRE_ID),
  );
  bot.command("monthly", async (ctx) =>
    startQuestionnaire(ctx, dependencies, MONTHLY_QUESTIONNAIRE_ID),
  );
  bot.command("status", async (ctx) => handleStatus(ctx, dependencies));
  bot.command("cancel", async (ctx) => handleCancel(ctx, dependencies));
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCallback(ctx, dependencies);
  });
  bot.on("message:photo", async (ctx) => handlePhotoMessage(ctx, dependencies));
  bot.on("message:text", async (ctx) => handleTextMessage(ctx, dependencies));
}

async function handleStart(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  dependencies.logger.info(
    { telegramUserId: identity.userId },
    "telegram user started bot",
  );

  if (!(await isProfileComplete(dependencies.eventStore, identity.userId))) {
    await startQuestionnaire(ctx, dependencies, PROFILE_QUESTIONNAIRE_ID);
    return;
  }

  await ctx.reply(getMainMenuText());
}

async function startQuestionnaire(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  questionnaireId: QuestionnaireId,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  const result = await dependencies.questionnaireEngine.start({
    chatId: identity.chatId,
    questionnaireId,
    userId: identity.userId,
  });

  await replyWithResult(ctx, result);
}

async function handleStatus(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  const events = await dependencies.eventStore.loadByUser(identity.userId);
  const profileStatus = getQuestionnaireStatus(
    events,
    PROFILE_QUESTIONNAIRE_ID,
  );
  const activeFlow = await dependencies.activeFlowStore.get(identity.userId);
  const profileText = profileStatus.completed
    ? "Профиль: заполнен"
    : "Профиль: не заполнен";
  const activeText =
    activeFlow === undefined
      ? "Активная анкета: нет"
      : `Активная анкета: ${activeFlow.questionnaireId}`;

  await ctx.reply([profileText, activeText, "", getMainMenuText()].join("\n"));
}

async function handleCancel(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  const result = await dependencies.questionnaireEngine.cancel({
    reason: "user_requested",
    userId: identity.userId,
  });

  await replyWithResult(ctx, result);
}

async function handleCallback(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);
  const data = ctx.callbackQuery?.data;

  if (identity === undefined || data === undefined) {
    await ctx.reply("Не удалось обработать действие.");
    return;
  }

  const input = parseCallbackData(data);

  if (input === undefined) {
    await ctx.reply("Это действие больше не поддерживается.");
    return;
  }

  const result = await dependencies.questionnaireEngine.answer({
    input,
    userId: identity.userId,
  });

  await editOrReplyWithResult(ctx, result);
}

async function handlePhotoMessage(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);
  const photo = ctx.message?.photo?.at(-1);

  if (identity === undefined || photo === undefined) {
    await ctx.reply("Не удалось обработать фото.");
    return;
  }

  const result = await dependencies.questionnaireEngine.answer({
    input: {
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      type: "photo",
    },
    userId: identity.userId,
  });

  await replyWithResult(ctx, result);
}

async function handleTextMessage(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
): Promise<void> {
  const identity = getIdentity(ctx);
  const text = ctx.message?.text;

  if (identity === undefined || text === undefined) {
    await ctx.reply("Не удалось обработать сообщение.");
    return;
  }

  if (text.startsWith("/")) {
    return;
  }

  const active = await dependencies.questionnaireEngine.getActiveQuestion(
    identity.userId,
  );

  if (active === undefined) {
    await ctx.reply(
      "Нет активной анкеты. Используйте /profile, /daily, /weekly или /monthly.",
    );
    return;
  }

  const result = await dependencies.questionnaireEngine.answer({
    input: mapTextToAnswerInput(active.question, text),
    userId: identity.userId,
  });

  await replyWithResult(ctx, result);
}

function parseCallbackData(
  callbackData: string,
): QuestionnaireAnswerInput | undefined {
  const [prefix, action, value] = callbackData.split(":");

  if (prefix !== CALLBACK_PREFIX) {
    return undefined;
  }

  if (action === "single" && value !== undefined) {
    return {
      optionId: value,
      type: "single",
    };
  }

  if (action === "multi" && value !== undefined) {
    return {
      optionId: value,
      type: "multi_toggle",
    };
  }

  if (action === "multi_done") {
    return {
      type: "multi_done",
    };
  }

  if (action === "scale" && value !== undefined) {
    return {
      type: "scale_1_10",
      value,
    };
  }

  return undefined;
}

function mapTextToAnswerInput(
  question: QuestionDefinition,
  text: string,
): QuestionnaireAnswerInput {
  switch (question.type) {
    case "lab_panel":
      return {
        type: "lab_panel",
        values: parseLabPanelValues(question, text),
      };
    case "number":
      return {
        type: "number",
        value: text,
      };
    case "scale_1_10":
      return {
        type: "scale_1_10",
        value: text,
      };
    case "text":
      return {
        type: "text",
        value: text,
      };
    case "multi":
    case "photo":
    case "single":
      return {
        type: "text",
        value: text,
      };
  }
}

function parseLabPanelValues(
  question: LabPanelQuestion,
  text: string,
): Record<string, string | null> {
  const normalizedText = text.trim();

  if (/^(нет|skip|пропустить)$/iu.test(normalizedText)) {
    return Object.fromEntries(question.fields.map((field) => [field.id, null]));
  }

  const fieldIds = new Map(
    question.fields.map((field) => [normalizeLabField(field.id), field.id]),
  );
  const values: Record<string, string | null> = {};

  for (const part of normalizedText.split(/[,\n;]/u)) {
    const [rawKey, ...rawValueParts] = part.split(/[:=]/u);

    if (rawKey === undefined || rawValueParts.length === 0) {
      continue;
    }

    const fieldId = fieldIds.get(normalizeLabField(rawKey));

    if (fieldId === undefined) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();
    values[fieldId] = rawValue.length === 0 ? null : rawValue;
  }

  return values;
}

function normalizeLabField(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, "_");
}

async function replyWithResult(
  ctx: Context,
  result: QuestionnaireEngineResult,
): Promise<void> {
  const rendered = renderResult(result);

  if (rendered === undefined) {
    return;
  }

  await ctx.reply(rendered.text, toReplyOptions(rendered));
}

async function editOrReplyWithResult(
  ctx: Context,
  result: QuestionnaireEngineResult,
): Promise<void> {
  const rendered = renderResult(result);

  if (rendered === undefined) {
    return;
  }

  if (ctx.callbackQuery?.message !== undefined) {
    await ctx.editMessageText(rendered.text, toReplyOptions(rendered));
    return;
  }

  await ctx.reply(rendered.text, toReplyOptions(rendered));
}

function renderResult(
  result: QuestionnaireEngineResult,
): RenderedQuestion | undefined {
  if (
    (result.status === "answered" ||
      result.status === "multi_selection_changed" ||
      result.status === "started") &&
    result.question !== undefined
  ) {
    return renderQuestion(result.question, result.flow);
  }

  if (result.status === "rejected" && result.question !== undefined) {
    const rendered = renderQuestion(result.question, result.flow);
    const errorText = result.validationError ?? "Ответ не принят.";

    return {
      ...rendered,
      text: [
        `Не получилось записать ответ: ${errorText}`,
        "",
        rendered.text,
      ].join("\n"),
    };
  }

  if (result.status === "completed") {
    return {
      text: ["Готово. Ответы сохранены.", "", getMainMenuText()].join("\n"),
    };
  }

  if (result.status === "cancelled") {
    return {
      text: "Анкета отменена.",
    };
  }

  if (result.status === "no_active_flow") {
    return {
      text: "Нет активной анкеты.",
    };
  }

  return undefined;
}

function renderQuestion(
  question: QuestionDefinition,
  flow: ActiveQuestionnaireFlow | undefined,
): RenderedQuestion {
  switch (question.type) {
    case "lab_panel":
      return {
        text: [
          question.text,
          "",
          "Введите значения в формате:",
          question.fields.map((field) => `${field.id}=...`).join("\n"),
          "",
          "Если анализов нет, отправьте: пропустить",
        ].join("\n"),
      };
    case "multi":
      return {
        keyboard: renderMultiKeyboard(question, flow),
        text: question.text,
      };
    case "number":
      return {
        text: `${question.text}\n\nВведите число.`,
      };
    case "photo":
      return {
        text: `${question.text}\n\nЗагрузите фото.`,
      };
    case "scale_1_10":
      return {
        keyboard: renderScaleKeyboard(),
        text: question.text,
      };
    case "single":
      return {
        keyboard: renderSingleKeyboard(question),
        text: question.text,
      };
    case "text":
      return {
        text: question.text,
      };
  }
}

function renderSingleKeyboard(question: QuestionDefinition): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (question.type !== "single") {
    return keyboard;
  }

  for (const option of question.options) {
    keyboard.text(option.label, `${CALLBACK_PREFIX}:single:${option.id}`).row();
  }

  return keyboard;
}

function renderMultiKeyboard(
  question: QuestionDefinition,
  flow: ActiveQuestionnaireFlow | undefined,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (question.type !== "multi") {
    return keyboard;
  }

  const selected = new Set(flow?.multiSelections[question.id] ?? []);

  for (const option of question.options) {
    const prefix = selected.has(option.id) ? "✓ " : "";
    keyboard
      .text(`${prefix}${option.label}`, `${CALLBACK_PREFIX}:multi:${option.id}`)
      .row();
  }

  keyboard.text(
    question.doneLabel ?? "Готово",
    `${CALLBACK_PREFIX}:multi_done`,
  );

  return keyboard;
}

function renderScaleKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let value = 1; value <= 10; value += 1) {
    keyboard.text(String(value), `${CALLBACK_PREFIX}:scale:${value}`);

    if (value === 5) {
      keyboard.row();
    }
  }

  return keyboard;
}

function toReplyOptions(rendered: RenderedQuestion) {
  if (rendered.keyboard === undefined) {
    return undefined;
  }

  return {
    reply_markup: rendered.keyboard,
  };
}

async function isProfileComplete(
  eventStore: Pick<EventStore, "loadByUser">,
  userId: UserId,
): Promise<boolean> {
  const events = await eventStore.loadByUser(userId);

  return getQuestionnaireStatus(events, PROFILE_QUESTIONNAIRE_ID).completed;
}

function getIdentity(ctx: Context): TelegramIdentity | undefined {
  const telegramUserId = ctx.from?.id;
  const telegramChatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;

  if (telegramUserId === undefined || telegramChatId === undefined) {
    return undefined;
  }

  return {
    chatId: String(telegramChatId),
    telegramChatId,
    userId: String(telegramUserId),
  };
}

function getMainMenuText(): string {
  return [
    "Профиль заполнен. Доступные чек-ины:",
    "/daily — ежедневный чек-ин",
    "/weekly — еженедельный чек-ин",
    "/monthly — ежемесячный чек-ин",
    "/profile — заполнить профиль заново",
  ].join("\n");
}
