import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotCommand } from "grammy/types";
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
  AnswerMap,
  LabPanelQuestion,
  QuestionDefinition,
  QuestionnaireAnswerInput,
  QuestionnaireEngine,
  QuestionnaireEngineResult,
  QuestionnaireProgress,
} from "../questionnaire/index.js";
import {
  projectUserStatus,
  type PeriodCheckInStatus,
  type UserStatusReadModel,
} from "../status/questionnaire-status.js";
import { getPeriodKey } from "../domain/index.js";
import type {
  AnswerValue,
  CheckInPeriod,
  EventStore,
  QuestionnaireId,
  QuestionId,
  StoredDomainEvent,
  UserId,
} from "../domain/index.js";

const CALLBACK_PREFIX = "q";
const HTML_PARSE_MODE = "HTML";

export interface TelegramAdapterDependencies {
  readonly activeFlowStore: ActiveFlowStore;
  readonly clock?: () => Date;
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
  readonly pendingPeriodStarts: Map<UserId, QuestionnaireId>;
}

type CallbackAction =
  | {
      readonly input: QuestionnaireAnswerInput;
      readonly type: "answer";
    }
  | {
      readonly type: "back";
    }
  | {
      readonly type: "cancel";
    }
  | {
      readonly questionnaireId: QuestionnaireId;
      readonly type: "start_cancel";
    }
  | {
      readonly questionnaireId: QuestionnaireId;
      readonly type: "start_confirm";
    };

export const telegramBotCommands: readonly BotCommand[] = [
  { command: "start", description: "старт и главное меню" },
  { command: "help", description: "помощь и ограничения MVP" },
  { command: "profile", description: "заполнить профиль" },
  { command: "daily", description: "ежедневный чек-ин" },
  { command: "weekly", description: "еженедельный чек-ин" },
  { command: "monthly", description: "ежемесячные анализы" },
  { command: "status", description: "статус профиля и чек-инов" },
  { command: "cancel", description: "отменить активную анкету" },
];

export async function configureTelegramCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([...telegramBotCommands]);
}

export function registerTelegramHandlers(
  bot: Bot,
  dependencies: TelegramAdapterDependencies,
): void {
  const state: TelegramAdapterState = {
    answerSummaryMessageIds: new Map(),
    pendingPeriodStarts: new Map(),
  };

  bot.command("start", async (ctx) => handleStart(ctx, dependencies, state));
  bot.command("help", async (ctx) => handleHelp(ctx));
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

async function handleHelp(ctx: Context): Promise<void> {
  await replyHtml(ctx, getHelpText());
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
    await replyHtml(ctx, "⚠️ Не удалось определить пользователя Telegram.");
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

  await replyHtml(ctx, getMainMenuText());
}

async function startQuestionnaire(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
  questionnaireId: QuestionnaireId,
  options: { readonly skipPeriodConfirmation?: boolean } = {},
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await replyHtml(ctx, "⚠️ Не удалось определить пользователя Telegram.");
    return;
  }

  if (
    options.skipPeriodConfirmation !== true &&
    (await shouldConfirmPeriodStart(
      dependencies,
      identity.userId,
      questionnaireId,
    ))
  ) {
    state.pendingPeriodStarts.set(identity.userId, questionnaireId);
    await replyHtml(
      ctx,
      [
        "ℹ️ <b>Этот чек-ин уже заполнен за текущий период.</b>",
        "Обновить ответы?",
      ].join("\n"),
      new InlineKeyboard()
        .text("Обновить", `${CALLBACK_PREFIX}:start_confirm:${questionnaireId}`)
        .text("Отмена", `${CALLBACK_PREFIX}:start_cancel:${questionnaireId}`),
    );
    return;
  }

  clearAnswerSummaryMessagesForUser(state, identity.userId);
  const initialAnswers =
    questionnaireId === PROFILE_QUESTIONNAIRE_ID
      ? await getLatestQuestionnaireAnswers(
          dependencies.eventStore,
          identity.userId,
          questionnaireId,
        )
      : undefined;

  const result = await dependencies.questionnaireEngine.start({
    chatId: identity.chatId,
    ...(initialAnswers === undefined ? {} : { initialAnswers }),
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
    await replyHtml(ctx, "⚠️ Не удалось определить пользователя Telegram.");
    return;
  }

  const events = await dependencies.eventStore.loadByUser(identity.userId);
  const status = projectUserStatus(events, {
    profileQuestionnaireId: PROFILE_QUESTIONNAIRE_ID,
  });
  const activeFlow = await dependencies.activeFlowStore.get(identity.userId);

  await replyHtml(ctx, renderStatusMessage(status, activeFlow));
}

async function shouldConfirmPeriodStart(
  dependencies: TelegramAdapterDependencies,
  userId: UserId,
  questionnaireId: QuestionnaireId,
): Promise<boolean> {
  const period = getQuestionnairePeriod(questionnaireId);

  if (period === undefined) {
    return false;
  }

  const events = await dependencies.eventStore.loadByUser(userId);
  const status = projectUserStatus(events, {
    profileQuestionnaireId: PROFILE_QUESTIONNAIRE_ID,
  });
  const existingCheckIn = status.checkIns[period];

  return (
    existingCheckIn?.periodKey ===
    getPeriodKey(period, getAdapterNow(dependencies))
  );
}

function getAdapterNow(dependencies: TelegramAdapterDependencies): Date {
  return dependencies.clock?.() ?? new Date();
}

async function handleStartConfirmation(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
  identity: TelegramIdentity,
  action: Extract<CallbackAction, { type: "start_confirm" }>,
): Promise<void> {
  if (
    state.pendingPeriodStarts.get(identity.userId) !== action.questionnaireId
  ) {
    await replyHtml(ctx, "⚠️ Подтверждение устарело. Запустите чек-ин заново.");
    return;
  }

  state.pendingPeriodStarts.delete(identity.userId);
  await editCurrentMessageOrReply(
    ctx,
    dependencies.logger,
    "✅ Обновляю чек-ин.",
  );
  await startQuestionnaire(ctx, dependencies, state, action.questionnaireId, {
    skipPeriodConfirmation: true,
  });
}

async function editCurrentMessageOrReply(
  ctx: Context,
  logger: Logger,
  text: string,
): Promise<void> {
  if (ctx.callbackQuery?.message === undefined) {
    await replyHtml(ctx, text);
    return;
  }

  try {
    await ctx.editMessageText(text, toHtmlReplyOptions());
  } catch (error) {
    logger.warn({ err: error }, "failed to edit telegram message");
    await replyHtml(ctx, text);
  }
}

async function handleCancel(
  ctx: Context,
  dependencies: TelegramAdapterDependencies,
  state: TelegramAdapterState,
): Promise<void> {
  const identity = getIdentity(ctx);

  if (identity === undefined) {
    await replyHtml(ctx, "⚠️ Не удалось определить пользователя Telegram.");
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
    await replyHtml(ctx, "⚠️ Не удалось обработать действие.");
    return;
  }

  const action = parseCallbackData(data);

  if (action === undefined) {
    await replyHtml(ctx, "⚠️ Это действие больше не поддерживается.");
    return;
  }

  if (action.type === "start_confirm") {
    await handleStartConfirmation(ctx, dependencies, state, identity, action);
    return;
  }

  if (action.type === "start_cancel") {
    state.pendingPeriodStarts.delete(identity.userId);
    await editCurrentMessageOrReply(
      ctx,
      dependencies.logger,
      "ℹ️ Ок, не обновляю чек-ин.",
    );
    return;
  }

  if (action.type === "cancel") {
    const result = await dependencies.questionnaireEngine.cancel({
      reason: "user_requested_inline",
      userId: identity.userId,
    });
    clearAnswerSummaryMessagesForUser(state, identity.userId);
    await replyWithResult(ctx, result);
    return;
  }

  if (action.type === "back") {
    const result = await dependencies.questionnaireEngine.back({
      userId: identity.userId,
    });
    await editOrReplyWithResult(ctx, result);
    return;
  }

  const active = await dependencies.questionnaireEngine.getActiveQuestion(
    identity.userId,
  );
  const result = await dependencies.questionnaireEngine.answer({
    input: action.input,
    userId: identity.userId,
  });
  const confirmationText = renderCallbackAnswerConfirmation(
    active,
    action.input,
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
    await replyHtml(ctx, text);
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
        toHtmlReplyOptions(),
      );
      return;
    } catch (error) {
      logger.warn({ err: error }, "failed to edit answer summary message");
      state.answerSummaryMessageIds.delete(key);
    }
  }

  const message = await ctx.reply(text, toHtmlReplyOptions());
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
      renderQuestion(active.question, active.flow, active.progress).text,
      toHtmlReplyOptions(),
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
    await replyHtml(ctx, "⚠️ Не удалось обработать фото.");
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
    await replyHtml(ctx, "⚠️ Не удалось обработать сообщение.");
    return;
  }

  if (text.startsWith("/")) {
    return;
  }

  const active = await dependencies.questionnaireEngine.getActiveQuestion(
    identity.userId,
  );

  if (active === undefined) {
    await replyHtml(
      ctx,
      [
        "ℹ️ <b>Нет активной анкеты.</b>",
        `Используйте ${code("/profile")}, ${code("/daily")}, ${code("/weekly")} или ${code("/monthly")}.`,
      ].join("\n"),
    );
    return;
  }

  const result = await dependencies.questionnaireEngine.answer({
    input: mapTextToAnswerInput(active.question, text),
    userId: identity.userId,
  });

  await replyWithResult(ctx, result);
}

function parseCallbackData(callbackData: string): CallbackAction | undefined {
  const [prefix, action, value] = callbackData.split(":");

  if (prefix !== CALLBACK_PREFIX) {
    return undefined;
  }

  if (action === "back") {
    return {
      type: "back",
    };
  }

  if (action === "cancel") {
    return {
      type: "cancel",
    };
  }

  if (action === "skip") {
    return {
      input: {
        type: "skip",
      },
      type: "answer",
    };
  }

  if (action === "start_confirm" && value !== undefined) {
    return {
      questionnaireId: value,
      type: "start_confirm",
    };
  }

  if (action === "start_cancel" && value !== undefined) {
    return {
      questionnaireId: value,
      type: "start_cancel",
    };
  }

  if (action === "single" && value !== undefined) {
    return {
      input: {
        optionId: value,
        type: "single",
      },
      type: "answer",
    };
  }

  if (action === "multi" && value !== undefined) {
    return {
      input: {
        optionId: value,
        type: "multi_toggle",
      },
      type: "answer",
    };
  }

  if (action === "multi_done") {
    return {
      input: {
        type: "multi_done",
      },
      type: "answer",
    };
  }

  if (action === "scale" && value !== undefined) {
    return {
      input: {
        type: "scale_1_10",
        value,
      },
      type: "answer",
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
      result.status === "moved_back" ||
      result.status === "multi_selection_changed" ||
      result.status === "started") &&
    result.question !== undefined
  ) {
    return renderQuestion(result.question, result.flow, result.progress);
  }

  if (result.status === "rejected" && result.question !== undefined) {
    const rendered = renderQuestion(
      result.question,
      result.flow,
      result.progress,
    );
    const errorText = result.validationError ?? "Ответ не принят.";

    return {
      ...rendered,
      text: [
        "⚠️ <b>Не получилось записать ответ</b>",
        escapeHtml(errorText),
        "",
        rendered.text,
      ].join("\n"),
    };
  }

  if (result.status === "completed") {
    return {
      text: renderCompletionMessage(result),
    };
  }

  if (result.status === "cancelled") {
    return {
      text: "ℹ️ <b>Анкета отменена.</b>",
    };
  }

  if (result.status === "no_active_flow") {
    return {
      text: "ℹ️ <b>Нет активной анкеты.</b>",
    };
  }

  return undefined;
}

function renderCompletionMessage(result: QuestionnaireEngineResult): string {
  const recap = renderCompletionRecap(result.questionnaire, result.answers);

  return [
    "✅ <b>Готово.</b> Ответы сохранены.",
    ...(recap.length === 0 ? [] : ["", ...recap]),
    "",
    getMainMenuText(),
  ].join("\n");
}

function renderCompletionRecap(
  questionnaire: QuestionnaireEngineResult["questionnaire"],
  answers: QuestionnaireEngineResult["answers"],
): string[] {
  if (questionnaire === undefined || answers === undefined) {
    return [];
  }

  const lines = [
    `<b>Итоги: ${escapeHtml(questionnaire.title ?? questionnaire.id)}</b>`,
  ];

  for (const question of questionnaire.questions) {
    if (!Object.hasOwn(answers, question.id)) {
      continue;
    }

    lines.push(
      `• <b>${escapeHtml(question.text)}:</b> ${escapeHtml(
        formatAnswer(question, answers[question.id]),
      )}`,
    );
  }

  return lines;
}

function formatAnswer(
  question: QuestionDefinition,
  answer: AnswerValue | undefined,
): string {
  if (answer === undefined || answer === null) {
    return "пропущено";
  }

  switch (question.type) {
    case "lab_panel":
      return formatLabPanelAnswer(question, answer);
    case "multi":
      if (!Array.isArray(answer)) {
        return String(answer);
      }

      return answer
        .map((optionId) => findOptionLabel(question, String(optionId)))
        .join(", ");
    case "photo":
      return "фото получено";
    case "single":
      return findOptionLabel(question, String(answer));
    case "number":
    case "scale_1_10":
    case "text":
      return String(answer);
  }
}

function formatLabPanelAnswer(
  question: LabPanelQuestion,
  answer: AnswerValue,
): string {
  if (!isRecord(answer)) {
    return String(answer);
  }

  const submitted: string[] = [];
  let skipped = 0;

  for (const field of question.fields) {
    const value = answer[field.id];

    if (value === null || value === undefined || value === "") {
      skipped += 1;
      continue;
    }

    submitted.push(`${field.label}: ${String(value)}`);
  }

  if (submitted.length === 0) {
    return "анализы не указаны";
  }

  return [
    submitted.join("; "),
    skipped === 0 ? undefined : `пропущено: ${skipped}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
}

function isRecord(value: AnswerValue): value is Record<string, AnswerValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return `✅ <b>Ваш ответ:</b> ${escapeHtml(
      findOptionLabel(question, input.optionId),
    )}`;
  }

  if (input.type === "scale_1_10") {
    return `✅ <b>Ваш ответ:</b> ${escapeHtml(String(input.value))}`;
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

    return `✅ <b>Ваш ответ:</b> ${escapeHtml(labels.join(", "))}`;
  }

  return undefined;
}

function renderMultiSelectionConfirmation(
  question: Extract<QuestionDefinition, { type: "multi" }>,
  selectedOptionIds: readonly string[],
): string {
  if (selectedOptionIds.length === 0) {
    return "ℹ️ Пока ничего не выбрано.";
  }

  const labels = selectedOptionIds.map((optionId) =>
    findOptionLabel(question, optionId),
  );

  return `✅ <b>Вы выбрали:</b> ${escapeHtml(labels.join(", "))}`;
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
  progress: QuestionnaireProgress | undefined,
): RenderedQuestion {
  const text = (body: string) =>
    [renderQuestionHeader(question, progress), body]
      .filter((part) => part.length > 0)
      .join("\n\n");
  const body = (details?: string) =>
    [
      `<b>${escapeHtml(question.text)}</b>`,
      renderCurrentAnswer(question, flow),
      details,
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("\n\n");

  switch (question.type) {
    case "lab_panel":
      return {
        keyboard: renderNavigationKeyboard(question, progress),
        text: text(
          body(
            [
              "Введите значения в формате:",
              question.fields
                .map(
                  (field) =>
                    `${code(`${field.id}=...`)} (${escapeHtml(field.label)})`,
                )
                .join("\n"),
              "",
              `Например: ${code("ferritin=42, vitamin_d=35")}`,
              "",
              "Чтобы пропустить отдельное значение, оставьте его пустым или напишите: пропустить",
              `Если анализов нет, отправьте: ${code("пропустить")}`,
            ].join("\n"),
          ),
        ),
      };
    case "multi":
      return {
        keyboard: renderNavigationKeyboard(
          question,
          progress,
          renderMultiKeyboard(question, flow),
        ),
        text: text(body()),
      };
    case "number":
      return {
        keyboard: renderNavigationKeyboard(question, progress),
        text: text(
          body(
            question.integer === true
              ? `Введите целое число, например ${code("35")}.`
              : `Введите число, например ${code("64.5")}.`,
          ),
        ),
      };
    case "photo":
      return {
        keyboard: renderNavigationKeyboard(question, progress),
        text: text(
          body(
            `Загрузите фото или отмените анкету командой ${code("/cancel")}.`,
          ),
        ),
      };
    case "scale_1_10":
      return {
        keyboard: renderNavigationKeyboard(
          question,
          progress,
          renderScaleKeyboard(),
        ),
        text: text(
          body("Выберите оценку кнопкой или отправьте число от 1 до 10."),
        ),
      };
    case "single":
      return {
        keyboard: renderNavigationKeyboard(
          question,
          progress,
          renderSingleKeyboard(question, flow),
        ),
        text: text(body()),
      };
    case "text":
      return {
        keyboard: renderNavigationKeyboard(question, progress),
        text: text(body()),
      };
  }
}

function renderCurrentAnswer(
  question: QuestionDefinition,
  flow: ActiveQuestionnaireFlow | undefined,
): string | undefined {
  if (flow === undefined || !Object.hasOwn(flow.answers, question.id)) {
    return undefined;
  }

  return `↳ <b>Текущий ответ:</b> ${escapeHtml(
    formatAnswer(question, flow.answers[question.id]),
  )}`;
}

function renderNavigationKeyboard(
  question: QuestionDefinition,
  progress: QuestionnaireProgress | undefined,
  keyboard = new InlineKeyboard(),
): InlineKeyboard {
  const canGoBack = progress !== undefined && progress.current > 1;
  const canSkip = question.required === false;

  if (!canGoBack && !canSkip) {
    keyboard.row().text("Отмена", `${CALLBACK_PREFIX}:cancel`);
    return keyboard;
  }

  keyboard.row();

  if (canGoBack) {
    keyboard.text("Назад", `${CALLBACK_PREFIX}:back`);
  }

  if (canSkip) {
    keyboard.text("Пропустить", `${CALLBACK_PREFIX}:skip`);
  }

  keyboard.text("Отмена", `${CALLBACK_PREFIX}:cancel`);

  return keyboard;
}

function renderQuestionHeader(
  question: QuestionDefinition,
  progress: QuestionnaireProgress | undefined,
): string {
  const parts = [
    progress === undefined
      ? undefined
      : `<b>Вопрос ${progress.current} из ${progress.total}</b>`,
    question.section === undefined
      ? undefined
      : `<i>${escapeHtml(question.section)}</i>`,
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return parts.join("\n");
}

function renderSingleKeyboard(
  question: QuestionDefinition,
  flow: ActiveQuestionnaireFlow | undefined,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (question.type !== "single") {
    return keyboard;
  }

  const currentAnswer = flow?.answers[question.id];

  for (const option of question.options) {
    const prefix =
      currentAnswer !== undefined &&
      answersEqual(currentAnswer, option.value ?? option.id)
        ? "✓ "
        : "";

    keyboard
      .text(
        `${prefix}${option.label}`,
        `${CALLBACK_PREFIX}:single:${option.id}`,
      )
      .row();
  }

  return keyboard;
}

function answersEqual(left: AnswerValue, right: AnswerValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  return toHtmlReplyOptions(rendered.keyboard);
}

async function replyHtml(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  await ctx.reply(text, toHtmlReplyOptions(keyboard));
}

function toHtmlReplyOptions(keyboard?: InlineKeyboard) {
  return {
    parse_mode: HTML_PARSE_MODE,
    ...(keyboard === undefined ? {} : { reply_markup: keyboard }),
  } as const;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
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

async function getLatestQuestionnaireAnswers(
  eventStore: Pick<EventStore, "loadByUser">,
  userId: UserId,
  questionnaireId: QuestionnaireId,
): Promise<AnswerMap> {
  const events = await eventStore.loadByUser(userId);

  return projectLatestQuestionnaireAnswers(events, questionnaireId);
}

function projectLatestQuestionnaireAnswers(
  events: readonly StoredDomainEvent[],
  questionnaireId: QuestionnaireId,
): AnswerMap {
  const answers: Record<QuestionId, AnswerValue> = {};

  for (const event of events) {
    if (
      event.type !== "AnswerRecorded" ||
      event.payload.questionnaireId !== questionnaireId
    ) {
      continue;
    }

    answers[event.payload.questionId] = event.payload.answer;
  }

  return answers;
}

function renderStatusMessage(
  status: UserStatusReadModel,
  activeFlow: ActiveQuestionnaireFlow | undefined,
): string {
  return [
    "📋 <b>Статус</b>",
    status.profile.completed
      ? "<b>Профиль:</b> заполнен"
      : "<b>Профиль:</b> не заполнен",
    activeFlow === undefined
      ? "<b>Активная анкета:</b> нет"
      : `<b>Активная анкета:</b> ${escapeHtml(
          getQuestionnaireLabel(activeFlow.questionnaireId),
        )}`,
    "",
    "<b>Последние чек-ины</b>",
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
    return `• <b>${escapeHtml(label)}:</b> нет`;
  }

  return `• <b>${escapeHtml(label)}:</b> ${code(
    checkIn.periodKey,
  )}, обновлено ${code(formatStatusDateTime(checkIn.completedAt))}`;
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

function getQuestionnairePeriod(
  questionnaireId: QuestionnaireId,
): CheckInPeriod | undefined {
  switch (questionnaireId) {
    case DAILY_QUESTIONNAIRE_ID:
      return "daily";
    case MONTHLY_QUESTIONNAIRE_ID:
      return "monthly";
    case WEEKLY_QUESTIONNAIRE_ID:
      return "weekly";
    default:
      return undefined;
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
    "📌 <b>Доступные команды</b>",
    `${code("/daily")} — ежедневный чек-ин`,
    `${code("/weekly")} — еженедельный чек-ин`,
    `${code("/monthly")} — ежемесячные анализы`,
    `${code("/status")} — статус профиля и чек-инов`,
    `${code("/help")} — помощь`,
    `${code("/profile")} — редактировать профиль`,
    `${code("/cancel")} — отменить активную анкету`,
  ].join("\n");
}

function getHelpText(): string {
  return [
    "ℹ️ <b>Помощь</b>",
    "",
    "Бот помогает вести профиль и регулярные чек-ины в Telegram.",
    "",
    getMainMenuText(),
    "",
    "<b>Важно</b>",
    "Данные пока хранятся только в памяти и исчезают после перезапуска.",
    "Бот не дает медицинских советов, диагнозов, интерпретации анализов или фото.",
  ].join("\n");
}
