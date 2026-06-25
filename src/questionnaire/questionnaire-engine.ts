import type { EventBus, EventStore } from "../domain/index.js";
import { getPeriodKey } from "../domain/index.js";
import { createDomainEvent } from "../domain/index.js";
import type {
  AnswerRecordedPayload,
  AnswerRejectedPayload,
  AnswerValue,
  ChatId,
  DomainEvent,
  DomainEventPayloads,
  QuestionId,
  QuestionnaireCancelledPayload,
  QuestionnaireId,
  UserId,
} from "../domain/index.js";
import type { ActiveFlowStore } from "./active-flow-store.js";
import type {
  ActiveQuestionnaireFlow,
  AnswerMap,
  LabPanelQuestion,
  MultiQuestion,
  NumberQuestion,
  PhotoQuestion,
  QuestionDefinition,
  QuestionnaireProgress,
  QuestionnaireAnswerInput,
  QuestionnaireDefinition,
  ScaleQuestion,
  SingleQuestion,
  TextQuestion,
} from "./types.js";

export type QuestionnaireEngineStatus =
  | "answered"
  | "cancelled"
  | "completed"
  | "moved_back"
  | "multi_selection_changed"
  | "no_active_flow"
  | "rejected"
  | "started";

export interface QuestionnaireEngineResult {
  readonly answers?: AnswerMap;
  readonly events: readonly DomainEvent[];
  readonly flow?: ActiveQuestionnaireFlow;
  readonly progress?: QuestionnaireProgress;
  readonly question?: QuestionDefinition;
  readonly questionnaire?: QuestionnaireDefinition;
  readonly status: QuestionnaireEngineStatus;
  readonly validationError?: string;
}

export interface ActiveQuestionnaireResult {
  readonly flow: ActiveQuestionnaireFlow;
  readonly progress: QuestionnaireProgress;
  readonly question: QuestionDefinition;
  readonly questionnaire: QuestionnaireDefinition;
}

export interface StartQuestionnaireInput {
  readonly chatId?: ChatId;
  readonly questionnaireId: QuestionnaireId;
  readonly userId: UserId;
}

export interface AnswerQuestionnaireInput {
  readonly input: QuestionnaireAnswerInput;
  readonly userId: UserId;
}

export interface CancelQuestionnaireInput {
  readonly reason?: string;
  readonly userId: UserId;
}

export interface BackQuestionnaireInput {
  readonly userId: UserId;
}

export interface QuestionnaireEngineDependencies {
  readonly activeFlowStore: ActiveFlowStore;
  readonly clock?: () => Date;
  readonly eventBus?: Pick<EventBus, "publish">;
  readonly eventStore?: Pick<EventStore, "append">;
  readonly questionnaires: readonly QuestionnaireDefinition[];
}

type ValidationResult =
  | { readonly answer: AnswerValue; readonly kind: "valid" }
  | {
      readonly kind: "invalid";
      readonly rawInput?: string;
      readonly reason: string;
    }
  | {
      readonly kind: "toggle";
      readonly selectedOptionIds: readonly string[];
    };

export class QuestionnaireEngine {
  private readonly activeFlowStore: ActiveFlowStore;
  private readonly clock: () => Date;
  private readonly eventBus: Pick<EventBus, "publish"> | undefined;
  private readonly eventStore: Pick<EventStore, "append"> | undefined;
  private readonly questionnaires = new Map<
    QuestionnaireId,
    QuestionnaireDefinition
  >();

  constructor({
    activeFlowStore,
    clock = () => new Date(),
    eventBus,
    eventStore,
    questionnaires,
  }: QuestionnaireEngineDependencies) {
    this.activeFlowStore = activeFlowStore;
    this.clock = clock;
    this.eventBus = eventBus;
    this.eventStore = eventStore;

    for (const questionnaire of questionnaires) {
      if (this.questionnaires.has(questionnaire.id)) {
        throw new Error(
          `Duplicate questionnaire definition: ${questionnaire.id}`,
        );
      }

      this.questionnaires.set(questionnaire.id, questionnaire);
    }
  }

  async start(
    input: StartQuestionnaireInput,
  ): Promise<QuestionnaireEngineResult> {
    const questionnaire = this.getQuestionnaire(input.questionnaireId);
    const started = this.createFlowEvent(input, {
      type: "QuestionnaireStarted",
      payload: {
        questionnaireId: questionnaire.id,
      },
    });
    const firstQuestion = this.findNextVisibleQuestion(
      questionnaire,
      undefined,
      {},
    );

    if (firstQuestion === undefined) {
      const events = [
        started,
        ...this.createQuestionnaireCompletionEvents(input, questionnaire),
      ];
      await this.activeFlowStore.clear(input.userId);
      await this.emit(events);

      return {
        answers: {},
        events,
        questionnaire,
        status: "completed",
      };
    }

    const flow = this.createFlow(input, firstQuestion.id);
    await this.activeFlowStore.set(flow);
    await this.emit(started);

    return {
      events: [started],
      flow,
      progress: this.getQuestionProgress(questionnaire, firstQuestion.id, {}),
      question: firstQuestion,
      status: "started",
    };
  }

  async answer({
    input,
    userId,
  }: AnswerQuestionnaireInput): Promise<QuestionnaireEngineResult> {
    const flow = await this.activeFlowStore.get(userId);

    if (flow === undefined) {
      return {
        events: [],
        status: "no_active_flow",
      };
    }

    const questionnaire = this.getQuestionnaire(flow.questionnaireId);
    const question = this.getQuestion(questionnaire, flow.currentQuestionId);
    const validation = this.validateAnswer(question, input, flow);

    if (validation.kind === "toggle") {
      const nextFlow = {
        ...flow,
        multiSelections: {
          ...flow.multiSelections,
          [question.id]: validation.selectedOptionIds,
        },
      };
      await this.activeFlowStore.set(nextFlow);

      return {
        events: [],
        flow: nextFlow,
        progress: this.getQuestionProgress(
          questionnaire,
          question.id,
          flow.answers,
        ),
        question,
        status: "multi_selection_changed",
      };
    }

    if (validation.kind === "invalid") {
      const rejected = this.createAnswerRejectedEvent(
        flow,
        question.id,
        validation,
      );
      await this.emit(rejected);

      return {
        events: [rejected],
        flow,
        progress: this.getQuestionProgress(
          questionnaire,
          question.id,
          flow.answers,
        ),
        question,
        status: "rejected",
        validationError: validation.reason,
      };
    }

    const answerEvents = this.createAnswerRecordedEvents(
      flow,
      question,
      validation.answer,
      input,
    );
    const answers = {
      ...flow.answers,
      [question.id]: validation.answer,
    };
    const nextQuestion = this.findNextVisibleQuestion(
      questionnaire,
      question.id,
      answers,
    );

    if (nextQuestion === undefined) {
      const events = [
        ...answerEvents,
        ...this.createQuestionnaireCompletionEvents(flow, questionnaire),
      ];
      await this.activeFlowStore.clear(userId);
      await this.emit(events);

      return {
        answers,
        events,
        questionnaire,
        status: "completed",
      };
    }

    const nextFlow = {
      ...flow,
      answers,
      currentQuestionId: nextQuestion.id,
    };
    await this.activeFlowStore.set(nextFlow);
    await this.emit(answerEvents);

    return {
      events: answerEvents,
      flow: nextFlow,
      progress: this.getQuestionProgress(
        questionnaire,
        nextQuestion.id,
        answers,
      ),
      question: nextQuestion,
      status: "answered",
    };
  }

  async getActiveQuestion(
    userId: UserId,
  ): Promise<ActiveQuestionnaireResult | undefined> {
    const flow = await this.activeFlowStore.get(userId);

    if (flow === undefined) {
      return undefined;
    }

    const questionnaire = this.getQuestionnaire(flow.questionnaireId);
    const question = this.getQuestion(questionnaire, flow.currentQuestionId);

    return {
      flow,
      progress: this.getQuestionProgress(
        questionnaire,
        question.id,
        flow.answers,
      ),
      question,
      questionnaire,
    };
  }

  async back({
    userId,
  }: BackQuestionnaireInput): Promise<QuestionnaireEngineResult> {
    const flow = await this.activeFlowStore.get(userId);

    if (flow === undefined) {
      return {
        events: [],
        status: "no_active_flow",
      };
    }

    const questionnaire = this.getQuestionnaire(flow.questionnaireId);
    const currentQuestion = this.getQuestion(
      questionnaire,
      flow.currentQuestionId,
    );
    const previousQuestion = this.findPreviousVisibleQuestion(
      questionnaire,
      flow.currentQuestionId,
      flow.answers,
    );

    if (previousQuestion === undefined) {
      return {
        events: [],
        flow,
        progress: this.getQuestionProgress(
          questionnaire,
          currentQuestion.id,
          flow.answers,
        ),
        question: currentQuestion,
        status: "moved_back",
      };
    }

    const nextAnswers = omitAnswer(flow.answers, previousQuestion.id);
    const nextFlow = {
      ...flow,
      answers: nextAnswers,
      currentQuestionId: previousQuestion.id,
    };

    await this.activeFlowStore.set(nextFlow);

    return {
      events: [],
      flow: nextFlow,
      progress: this.getQuestionProgress(
        questionnaire,
        previousQuestion.id,
        nextAnswers,
      ),
      question: previousQuestion,
      status: "moved_back",
    };
  }

  async cancel({
    reason,
    userId,
  }: CancelQuestionnaireInput): Promise<QuestionnaireEngineResult> {
    const flow = await this.activeFlowStore.get(userId);

    if (flow === undefined) {
      return {
        events: [],
        status: "no_active_flow",
      };
    }

    const payload: QuestionnaireCancelledPayload = {
      questionnaireId: flow.questionnaireId,
      ...(reason === undefined ? {} : { reason }),
    };
    const cancelled = this.createFlowEvent(flow, {
      type: "QuestionnaireCancelled",
      payload,
    });

    await this.activeFlowStore.clear(userId);
    await this.emit(cancelled);

    return {
      events: [cancelled],
      status: "cancelled",
    };
  }

  private createFlow(
    input: StartQuestionnaireInput,
    currentQuestionId: QuestionId,
  ): ActiveQuestionnaireFlow {
    return {
      answers: {},
      currentQuestionId,
      multiSelections: {},
      questionnaireId: input.questionnaireId,
      userId: input.userId,
      ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
    };
  }

  private createAnswerRecordedEvents(
    flow: ActiveQuestionnaireFlow,
    question: QuestionDefinition,
    answer: AnswerValue,
    input: QuestionnaireAnswerInput,
  ): DomainEvent[] {
    const answerPayload: AnswerRecordedPayload = {
      answer,
      questionnaireId: flow.questionnaireId,
      questionId: question.id,
    };
    const answerRecorded = this.createFlowEvent(flow, {
      type: "AnswerRecorded",
      payload: answerPayload,
    });

    if (question.type !== "photo" || input.type !== "photo") {
      return [answerRecorded];
    }

    const photoReceived = this.createFlowEvent(flow, {
      type: "PhotoReceived",
      payload: {
        fileId: input.fileId,
        questionnaireId: flow.questionnaireId,
        questionId: question.id,
        ...(input.fileUniqueId === undefined
          ? {}
          : { fileUniqueId: input.fileUniqueId }),
      },
    });

    return [photoReceived, answerRecorded];
  }

  private createAnswerRejectedEvent(
    flow: ActiveQuestionnaireFlow,
    questionId: QuestionId,
    validation: Extract<ValidationResult, { kind: "invalid" }>,
  ): DomainEvent<"AnswerRejected"> {
    const payload: AnswerRejectedPayload = {
      questionnaireId: flow.questionnaireId,
      questionId,
      reason: validation.reason,
      ...(validation.rawInput === undefined
        ? {}
        : { rawInput: validation.rawInput }),
    };

    return this.createFlowEvent(flow, {
      type: "AnswerRejected",
      payload,
    });
  }

  private createQuestionnaireCompletionEvents(
    flow: Pick<ActiveQuestionnaireFlow, "chatId" | "userId">,
    questionnaire: QuestionnaireDefinition,
  ): DomainEvent[] {
    const completed = this.createFlowEvent(flow, {
      type: "QuestionnaireCompleted",
      payload: {
        questionnaireId: questionnaire.id,
      },
    });
    const periodCompleted = this.createPeriodCheckInCompletedEvent(
      flow,
      questionnaire,
    );

    if (periodCompleted === undefined) {
      return [completed];
    }

    return [completed, periodCompleted];
  }

  private createPeriodCheckInCompletedEvent(
    flow: Pick<ActiveQuestionnaireFlow, "chatId" | "userId">,
    questionnaire: QuestionnaireDefinition,
  ): DomainEvent<"PeriodCheckInCompleted"> | undefined {
    if (questionnaire.period === undefined) {
      return undefined;
    }

    return this.createFlowEvent(flow, {
      type: "PeriodCheckInCompleted",
      payload: {
        period: questionnaire.period,
        periodKey: getPeriodKey(questionnaire.period, this.clock()),
        questionnaireId: questionnaire.id,
      },
    });
  }

  private createFlowEvent<TType extends keyof DomainEventPayloads>(
    flow: Pick<ActiveQuestionnaireFlow, "chatId" | "userId">,
    input: {
      readonly payload: DomainEventPayloads[TType];
      readonly type: TType;
    },
  ): DomainEvent<TType> {
    return createDomainEvent({
      type: input.type,
      userId: flow.userId,
      payload: input.payload,
      ...(flow.chatId === undefined ? {} : { chatId: flow.chatId }),
    });
  }

  private async emit(
    events: DomainEvent | readonly DomainEvent[],
  ): Promise<void> {
    const eventList = Array.isArray(events) ? events : [events];

    if (eventList.length === 0) {
      return;
    }

    await this.eventStore?.append(eventList);
    await this.eventBus?.publish(eventList);
  }

  private findNextVisibleQuestion(
    questionnaire: QuestionnaireDefinition,
    currentQuestionId: QuestionId | undefined,
    answers: ActiveQuestionnaireFlow["answers"],
  ): QuestionDefinition | undefined {
    const startIndex =
      currentQuestionId === undefined
        ? 0
        : questionnaire.questions.findIndex(
            (question) => question.id === currentQuestionId,
          ) + 1;

    for (const question of questionnaire.questions.slice(startIndex)) {
      if (isQuestionVisible(question, answers)) {
        return question;
      }
    }

    return undefined;
  }

  private findPreviousVisibleQuestion(
    questionnaire: QuestionnaireDefinition,
    currentQuestionId: QuestionId,
    answers: ActiveQuestionnaireFlow["answers"],
  ): QuestionDefinition | undefined {
    const visibleQuestions = questionnaire.questions.filter((question) =>
      isQuestionVisible(question, answers),
    );
    const currentIndex = visibleQuestions.findIndex(
      (question) => question.id === currentQuestionId,
    );

    if (currentIndex <= 0) {
      return undefined;
    }

    return visibleQuestions[currentIndex - 1];
  }

  private getQuestionProgress(
    questionnaire: QuestionnaireDefinition,
    currentQuestionId: QuestionId,
    answers: ActiveQuestionnaireFlow["answers"],
  ): QuestionnaireProgress {
    const visibleQuestions = questionnaire.questions.filter((question) =>
      isQuestionVisible(question, answers),
    );
    const currentIndex = visibleQuestions.findIndex(
      (question) => question.id === currentQuestionId,
    );

    return {
      current: currentIndex < 0 ? 1 : currentIndex + 1,
      total: visibleQuestions.length,
    };
  }

  private getQuestion(
    questionnaire: QuestionnaireDefinition,
    questionId: QuestionId,
  ): QuestionDefinition {
    const question = questionnaire.questions.find(
      (candidate) => candidate.id === questionId,
    );

    if (question === undefined) {
      throw new Error(
        `Question "${questionId}" not found in questionnaire "${questionnaire.id}"`,
      );
    }

    return question;
  }

  private getQuestionnaire(questionnaireId: QuestionnaireId) {
    const questionnaire = this.questionnaires.get(questionnaireId);

    if (questionnaire === undefined) {
      throw new Error(`Questionnaire definition not found: ${questionnaireId}`);
    }

    return questionnaire;
  }

  private validateAnswer(
    question: QuestionDefinition,
    input: QuestionnaireAnswerInput,
    flow: ActiveQuestionnaireFlow,
  ): ValidationResult {
    if (input.type === "skip") {
      return validateSkipAnswer(question);
    }

    switch (question.type) {
      case "lab_panel":
        return validateLabPanelAnswer(question, input);
      case "multi":
        return validateMultiAnswer(question, input, flow);
      case "number":
        return validateNumberAnswer(question, input);
      case "photo":
        return validatePhotoAnswer(question, input);
      case "scale_1_10":
        return validateScaleAnswer(question, input);
      case "single":
        return validateSingleAnswer(question, input);
      case "text":
        return validateTextAnswer(question, input);
    }
  }
}

function isQuestionVisible(
  question: QuestionDefinition,
  answers: ActiveQuestionnaireFlow["answers"],
): boolean {
  if (question.when === undefined) {
    return true;
  }

  return question.when({
    answers,
    getAnswer(questionId) {
      return answers[questionId];
    },
    hasAnswer(questionId) {
      return Object.hasOwn(answers, questionId);
    },
  });
}

function omitAnswer(
  answers: ActiveQuestionnaireFlow["answers"],
  questionId: QuestionId,
): ActiveQuestionnaireFlow["answers"] {
  const nextAnswers: Record<QuestionId, AnswerValue> = {};

  for (const [candidateQuestionId, answer] of Object.entries(answers)) {
    if (candidateQuestionId !== questionId) {
      nextAnswers[candidateQuestionId] = answer;
    }
  }

  return nextAnswers;
}

function validateTextAnswer(
  question: TextQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "text") {
    return invalid("Введите текст");
  }

  const shouldTrim = question.trim ?? true;
  const value = shouldTrim ? input.value.trim() : input.value;

  if ((question.required ?? true) && value.length === 0) {
    return invalid("Ответ обязателен", input.value);
  }

  if (question.minLength !== undefined && value.length < question.minLength) {
    return invalid(
      `Текст должен быть не короче ${question.minLength} символов`,
      value,
    );
  }

  if (question.maxLength !== undefined && value.length > question.maxLength) {
    return invalid(
      `Текст должен быть не длиннее ${question.maxLength} символов`,
      value,
    );
  }

  return {
    answer: value,
    kind: "valid",
  };
}

function validateSkipAnswer(question: QuestionDefinition): ValidationResult {
  if (question.required !== false) {
    return invalid("Этот вопрос обязателен");
  }

  if (question.type === "lab_panel") {
    return {
      answer: Object.fromEntries(
        question.fields.map((field) => [field.id, null]),
      ),
      kind: "valid",
    };
  }

  return {
    answer: null,
    kind: "valid",
  };
}

function validateNumberAnswer(
  question: NumberQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  const parsed = parseNumberInput(input);

  if (!parsed.ok) {
    return invalid(parsed.reason, parsed.rawInput);
  }

  return validateNumberConstraints(question, parsed.value);
}

function validateScaleAnswer(
  question: ScaleQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  const parsed = parseNumberInput(input);

  if (!parsed.ok) {
    return invalid("Выберите число от 1 до 10", parsed.rawInput);
  }

  if (
    !Number.isInteger(parsed.value) ||
    parsed.value < 1 ||
    parsed.value > 10
  ) {
    return invalid("Выберите число от 1 до 10", String(parsed.value));
  }

  return {
    answer: parsed.value,
    kind: "valid",
  };
}

function validateSingleAnswer(
  question: SingleQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "single") {
    return invalid("Выберите один вариант кнопкой");
  }

  const option = question.options.find(
    (candidate) => candidate.id === input.optionId,
  );

  if (option === undefined) {
    return invalid("Выберите вариант из списка", input.optionId);
  }

  return {
    answer: option.value ?? option.id,
    kind: "valid",
  };
}

function validateMultiAnswer(
  question: MultiQuestion,
  input: QuestionnaireAnswerInput,
  flow: ActiveQuestionnaireFlow,
): ValidationResult {
  const selectedOptionIds = flow.multiSelections[question.id] ?? [];

  if (input.type === "multi_toggle") {
    const option = question.options.find(
      (candidate) => candidate.id === input.optionId,
    );

    if (option === undefined) {
      return invalid("Выберите вариант из списка", input.optionId);
    }

    const isSelected = selectedOptionIds.includes(input.optionId);
    const nextSelectedOptionIds = isSelected
      ? selectedOptionIds.filter((optionId) => optionId !== input.optionId)
      : [...selectedOptionIds, input.optionId];

    if (
      !isSelected &&
      question.maxSelected !== undefined &&
      nextSelectedOptionIds.length > question.maxSelected
    ) {
      return invalid(
        `Выберите не больше ${question.maxSelected} вариантов`,
        input.optionId,
      );
    }

    return {
      kind: "toggle",
      selectedOptionIds: nextSelectedOptionIds,
    };
  }

  if (input.type !== "multi_done") {
    return invalid("Выберите один или несколько вариантов кнопками");
  }

  const minSelected =
    question.minSelected ?? (question.required === false ? 0 : 1);

  if (selectedOptionIds.length < minSelected) {
    return invalid(`Выберите минимум ${minSelected} вариант`);
  }

  const answer = selectedOptionIds.map((optionId) => {
    const option = question.options.find(
      (candidate) => candidate.id === optionId,
    );

    if (option === undefined) {
      throw new Error(`Selected option "${optionId}" is no longer defined`);
    }

    return option.value ?? option.id;
  });

  return {
    answer,
    kind: "valid",
  };
}

function validatePhotoAnswer(
  question: PhotoQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "photo") {
    return invalid("Загрузите фото или отмените анкету командой /cancel");
  }

  const fileId = input.fileId.trim();

  if (fileId.length === 0) {
    return invalid("Загрузите фото или отмените анкету командой /cancel");
  }

  return {
    answer: {
      fileId,
      ...(input.fileUniqueId === undefined
        ? {}
        : { fileUniqueId: input.fileUniqueId }),
    },
    kind: "valid",
  };
}

function validateLabPanelAnswer(
  question: LabPanelQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "lab_panel") {
    return invalid("Введите значения анализов или отправьте: пропустить");
  }

  const answer: Record<string, number | null> = {};

  for (const field of question.fields) {
    const rawValue = input.values[field.id];

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.required === true) {
        return invalid(`${field.label}: значение обязательно`);
      }

      answer[field.id] = null;
      continue;
    }

    const parsed = parseNumberValue(rawValue);

    if (!parsed.ok) {
      return invalid(`${field.label}: ${parsed.reason}`, String(rawValue));
    }

    const constrained = validateNumberConstraints(field, parsed.value);

    if (constrained.kind === "invalid") {
      return invalid(`${field.label}: ${constrained.reason}`, String(rawValue));
    }

    answer[field.id] = parsed.value;
  }

  return {
    answer,
    kind: "valid",
  };
}

type NumberParseResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly rawInput?: string; readonly reason: string };

function parseNumberInput(input: QuestionnaireAnswerInput): NumberParseResult {
  if (
    input.type !== "number" &&
    input.type !== "scale_1_10" &&
    input.type !== "text"
  ) {
    return {
      ok: false,
      reason: "Введите число",
    };
  }

  return parseNumberValue(input.value);
}

function parseNumberValue(value: string | number): NumberParseResult {
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return {
        ok: true,
        value,
      };
    }

    return {
      ok: false,
      rawInput: String(value),
      reason: "Введите число",
    };
  }

  const rawInput = value;
  const trimmed = rawInput.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      rawInput,
      reason: "Введите число",
    };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      rawInput,
      reason: "Введите число",
    };
  }

  return {
    ok: true,
    value: parsed,
  };
}

function validateNumberConstraints(
  question: Pick<NumberQuestion, "integer" | "max" | "min">,
  value: number,
): ValidationResult {
  if (question.integer === true && !Number.isInteger(value)) {
    return invalid("Введите целое число", String(value));
  }

  if (question.min !== undefined && value < question.min) {
    return invalid(
      `Число должно быть не меньше ${question.min}`,
      String(value),
    );
  }

  if (question.max !== undefined && value > question.max) {
    return invalid(
      `Число должно быть не больше ${question.max}`,
      String(value),
    );
  }

  return {
    answer: value,
    kind: "valid",
  };
}

function invalid(reason: string, rawInput?: string): ValidationResult {
  return {
    kind: "invalid",
    reason,
    ...(rawInput === undefined ? {} : { rawInput }),
  };
}
