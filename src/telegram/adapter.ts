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
import {
  projectUserStatus,
  type PeriodCheckInStatus,
  type UserStatusReadModel,
} from "../status/questionnaire-status.js";
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

interface TelegramAdapterState {
  readonly answerSummaryMessageIds: Map<string, number>;
}

export function registerTelegramHandlers(
  bot: Bot,
  dependencies: TelegramAdapterDependencies,
): void {
  const state: TelegramAdapterState = {
    answerSummaryMessageIds: new Map(),
  };

  bot.command("start", async (ctx) => handleStart(ctx, dependencies, state));
  bot.command("profile", async (ctx) =>
    startQuestionnaire(ctx, dependencies, state, PROFILE_QUESTIONNAIRE_ID),
  );
  bot.command("daily", async (ctx) =>
    startQuestionnaire(ctx, dependencies, state, DAILY_QUESTIONNAIRE_ID),
  );
  bot.command("weekly", async (ctx) =>
    startQuestionnaire(ctx, dependencies, state, WEEKLY_QUESTIONNAIRE_ID),
  );
  bot.command("monthly", async (ctx) =>
    startQuestionnaire(ctx, dependencies, state, MONTHLY_QUESTIONNAIRE_ID),
  );
  bot.command("status", async (ctx) => handleStatus(ctx, dependencies));
  bot.command("cancel", async (ctx) => handleCancel(ctx, dependencies, state));
  bot.on("callback_query:data", async (ctx) => {
    await safelyAnswerCallbackQuery(ctx, dependencies.logger);
    await handleCallback(ctx, dependencies, state);
  });
  bot.on("message:photo", async (ctx) => handlePhotoMessage(ctx, dependencies));
  bot.on("message:text", async (ctx) => handleTextMessage(ctx, dependencies));
}

async function safelyAnswerCallbackQuery(
  ctx: Context,
  logger: Logger,
): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    logger.warn({ err: error }, "failed to answer telegram callback query");
  }
}

async function handleStart(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
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
    await startQuestionnaire(
      ctx,
      dependencies,
      state,
      PROFILE_QUESTIONNAIRE_ID,
    );
    return;
  }

  await ctx.reply(getMainMenuText());
}

async function startQuestionnaire(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
  questionnaireId: QuestionnaireId,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  clearAnswerSummaryMessagesForUser(state, identity.userId);

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
  const status = projectUserStatus(events, {
    profileQuestionnaireId: PROFILE_QUESTIONNAIRE_ID,
  });
  const activeFlow = await dependencies.activeFlowStore.get(identity.userId);

  await ctx.reply(renderStatusMessage(status, activeFlow));
}

async function handleCancel(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
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

  clearAnswerSummaryMessagesForUser(state, identity.userId);
  await replyWithResult(ctx, result);
}

async function handleCallback(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
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

  const active = await dependencies.questionnaireEngine.getActiveQuestion(
    identity.userId,
  );
  const result = await dependencies.questionnaireEngine.answer({
    input,
    userId: identity.userId,
  });
  const confirmationText = renderCallbackAnswerConfirmation(
    active,
    input,
    result,
  );

  if (confirmationText !== undefined) {
    await upsertAnswerSummaryMessage(
      ctx,
      dependencies.logger,
      identity,
      state,
      active,
      confirmationText,
    );
  }

  if (shouldEditCurrentQuestionMessage(result)) {
    await editOrReplyWithResult(ctx, result);
    return;
  }

  await removeCurrentQuestionKeyboard(ctx, dependencies.logger, active);
  await replyWithResult(ctx, result);
}

async function upsertAnswerSummaryMessage(
  ctx: Context,
  logger: Logger,
  identity: TelegramIdentity,
  state: TelegramAdapterState,
  active:
    | Awaited<ReturnType<QuestionnaireEngine["getActiveQuestion"]>>
    | undefined,
  text: string,
): Promise<void> {
  if (active === undefined) {
    await ctx.reply(text);
    return;
  }

  const key = getAnswerSummaryMessageKey(identity.userId, active);
  const existingMessageId = state.answerSummaryMessageIds.get(key);

  if (existingMessageId !== undefined) {
    try {
      await ctx.api.editMessageText(
        identity.telegramChatId,
        existingMessageId,
        text,
      );
      return;
    } catch (error) {
      logger.warn({ err: error }, "failed to edit answer summary message");
      state.answerSummaryMessageIds.delete(key);
    }
  }

  const message = await ctx.reply(text);
  state.answerSummaryMessageIds.set(key, message.message_id);
}

function shouldEditCurrentQuestionMessage(
  result: QuestionnaireEngineResult,
): boolean {
  return result.status === "multi_selection_changed";
}

async function removeCurrentQuestionKeyboard(
  ctx: Context,
  logger: Logger,
  active:
    | Awaited<ReturnType<QuestionnaireEngine["getActiveQuestion"]>>
    | undefined,
): Promise<void> {
  if (ctx.callbackQuery?.message === undefined || active === undefined) {
    return;
  }

  try {
    await ctx.editMessageText(
      renderQuestion(active.question, active.flow).text,
    );
  } catch (error) {
    logger.warn({ err: error }, "failed to remove question keyboard");
  }
}

function getAnswerSummaryMessageKey(
  userId: UserId,
  active: NonNullable<
    Awaited<ReturnType<QuestionnaireEngine["getActiveQuestion"]>>
  >,
): string {
  return `${userId}:${active.flow.questionnaireId}:${active.question.id}`;
}

function clearAnswerSummaryMessagesForUser(
  state: TelegramAdapterState,
  userId: UserId,
): void {
  for (const key of state.answerSummaryMessageIds.keys()) {
    if (key.startsWith(`${userId}:`)) {
      state.answerSummaryMessageIds.delete(key);
    }
  }
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
    question.fields.flatMap((field) =>
      [field.id, field.label, ...(field.aliases ?? [])].map((alias) => [
        normalizeLabField(alias),
        field.id,
      ]),
    ),
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
    values[fieldId] =
      rawValue.length === 0 || isSkippedLabValue(rawValue) ? null : rawValue;
  }

  return values;
}

function isSkippedLabValue(value: string): boolean {
  return /^(нет|skip|пропустить)$/iu.test(value.trim());
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

function renderCallbackAnswerConfirmation(
  active:
    | Awaited<ReturnType<QuestionnaireEngine["getActiveQuestion"]>>
    | undefined,
  input: QuestionnaireAnswerInput,
  result: QuestionnaireEngineResult,
): string | undefined {
  if (
    active === undefined ||
    result.status === "no_active_flow" ||
    result.status === "rejected"
  ) {
    return undefined;
  }

  const question = active.question;

  if (input.type === "single" && question.type === "single") {
    return `Ваш ответ: ${findOptionLabel(question, input.optionId)}`;
  }

  if (input.type === "scale_1_10") {
    return `Ваш ответ: ${input.value}`;
  }

  if (input.type === "multi_toggle" && question.type === "multi") {
    const selectedOptionIds = result.flow?.multiSelections[question.id] ?? [];

    return renderMultiSelectionConfirmation(question, selectedOptionIds);
  }

  if (input.type === "multi_done" && question.type === "multi") {
    const labels = (active.flow.multiSelections[question.id] ?? []).map(
      (optionId) => findOptionLabel(question, optionId),
    );

    if (labels.length === 0) {
      return undefined;
    }

    return `Ваш ответ: ${labels.join(", ")}`;
  }

  return undefined;
}

function renderMultiSelectionConfirmation(
  question: Extract<QuestionDefinition, { type: "multi" }>,
  selectedOptionIds: readonly string[],
): string {
  if (selectedOptionIds.length === 0) {
    return "Вы пока ничего не выбрали.";
  }

  const labels = selectedOptionIds.map((optionId) =>
    findOptionLabel(question, optionId),
  );

  return `Вы выбрали: ${labels.join(", ")}`;
}

function findOptionLabel(
  question: Extract<QuestionDefinition, { type: "multi" | "single" }>,
  optionId: string,
): string {
  return (
    question.options.find((option) => option.id === optionId)?.label ?? optionId
  );
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
          question.fields
            .map((field) => `${field.id}=... (${field.label})`)
            .join("\n"),
          "",
          "Чтобы пропустить отдельное значение, оставьте его пустым или напишите: пропустить",
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
        text: `${question.text}\n\nЗагрузите фото или отмените анкету командой /cancel.`,
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
  const status = projectUserStatus(events, {
    profileQuestionnaireId: PROFILE_QUESTIONNAIRE_ID,
  });

  return status.profile.completed;
}

function renderStatusMessage(
  status: UserStatusReadModel,
  activeFlow: ActiveQuestionnaireFlow | undefined,
): string {
  return [
    "Статус",
    status.profile.completed ? "Профиль: заполнен" : "Профиль: не заполнен",
    activeFlow === undefined
      ? "Активная анкета: нет"
      : `Активная анкета: ${getQuestionnaireLabel(activeFlow.questionnaireId)}`,
    "",
    "Последние чек-ины:",
    renderCheckInStatusLine("Ежедневный", status.checkIns.daily),
    renderCheckInStatusLine("Еженедельный", status.checkIns.weekly),
    renderCheckInStatusLine("Ежемесячный", status.checkIns.monthly),
    "",
    getMainMenuText(),
  ].join("\n");
}

function renderCheckInStatusLine(
  label: string,
  checkIn: PeriodCheckInStatus | undefined,
): string {
  if (checkIn === undefined) {
    return `${label}: нет`;
  }

  return `${label}: ${checkIn.periodKey}, обновлено ${formatStatusDateTime(
    checkIn.completedAt,
  )}`;
}

function formatStatusDateTime(date: Date): string {
  return [
    [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join(
      "-",
    ),
    [pad2(date.getHours()), pad2(date.getMinutes())].join(":"),
  ].join(" ");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getQuestionnaireLabel(questionnaireId: QuestionnaireId): string {
  switch (questionnaireId) {
    case DAILY_QUESTIONNAIRE_ID:
      return "ежедневный чек-ин";
    case MONTHLY_QUESTIONNAIRE_ID:
      return "ежемесячный чек-ин";
    case PROFILE_QUESTIONNAIRE_ID:
      return "профиль";
    case WEEKLY_QUESTIONNAIRE_ID:
      return "еженедельный чек-ин";
    default:
      return questionnaireId;
  }
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
    "Доступные команды:",
    "/daily — ежедневный чек-ин",
    "/weekly — еженедельный чек-ин",
    "/monthly — ежемесячный чек-ин",
    "/status — статус профиля и чек-инов",
    "/profile — заполнить профиль заново",
  ].join("\n");
}
