import type { EventBus, EventStore } from "../domain/index.js";
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
  LabPanelQuestion,
  MultiQuestion,
  NumberQuestion,
  PhotoQuestion,
  QuestionDefinition,
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
  | "multi_selection_changed"
  | "no_active_flow"
  | "rejected"
  | "started";

export interface QuestionnaireEngineResult {
  readonly events: readonly DomainEvent[];
  readonly flow?: ActiveQuestionnaireFlow;
  readonly question?: QuestionDefinition;
  readonly status: QuestionnaireEngineStatus;
  readonly validationError?: string;
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

export interface QuestionnaireEngineDependencies {
  readonly activeFlowStore: ActiveFlowStore;
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
  private readonly eventBus: Pick<EventBus, "publish"> | undefined;
  private readonly eventStore: Pick<EventStore, "append"> | undefined;
  private readonly questionnaires = new Map<
    QuestionnaireId,
    QuestionnaireDefinition
  >();

  constructor({
    activeFlowStore,
    eventBus,
    eventStore,
    questionnaires,
  }: QuestionnaireEngineDependencies) {
    this.activeFlowStore = activeFlowStore;
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
      const completed = this.createFlowEvent(input, {
        type: "QuestionnaireCompleted",
        payload: {
          questionnaireId: questionnaire.id,
        },
      });
      const events = [started, completed];
      await this.activeFlowStore.clear(input.userId);
      await this.emit(events);

      return {
        events,
        status: "completed",
      };
    }

    const flow = this.createFlow(input, firstQuestion.id);
    await this.activeFlowStore.set(flow);
    await this.emit(started);

    return {
      events: [started],
      flow,
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
      const completed = this.createFlowEvent(flow, {
        type: "QuestionnaireCompleted",
        payload: {
          questionnaireId: questionnaire.id,
        },
      });
      const events = [...answerEvents, completed];
      await this.activeFlowStore.clear(userId);
      await this.emit(events);

      return {
        events,
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
      question: nextQuestion,
      status: "answered",
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

function validateTextAnswer(
  question: TextQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "text") {
    return invalid(`Expected text input, received ${input.type}`);
  }

  const shouldTrim = question.trim ?? true;
  const value = shouldTrim ? input.value.trim() : input.value;

  if ((question.required ?? true) && value.length === 0) {
    return invalid("Answer is required", input.value);
  }

  if (question.minLength !== undefined && value.length < question.minLength) {
    return invalid(
      `Text must be at least ${question.minLength} characters`,
      value,
    );
  }

  if (question.maxLength !== undefined && value.length > question.maxLength) {
    return invalid(
      `Text must be at most ${question.maxLength} characters`,
      value,
    );
  }

  return {
    answer: value,
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
    return invalid(parsed.reason, parsed.rawInput);
  }

  return validateNumberConstraints(
    {
      ...question,
      integer: true,
      max: 10,
      min: 1,
    },
    parsed.value,
  );
}

function validateSingleAnswer(
  question: SingleQuestion,
  input: QuestionnaireAnswerInput,
): ValidationResult {
  if (input.type !== "single") {
    return invalid(`Expected single choice input, received ${input.type}`);
  }

  const option = question.options.find(
    (candidate) => candidate.id === input.optionId,
  );

  if (option === undefined) {
    return invalid(`Unknown option: ${input.optionId}`, input.optionId);
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
      return invalid(`Unknown option: ${input.optionId}`, input.optionId);
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
        `Select at most ${question.maxSelected} option(s)`,
        input.optionId,
      );
    }

    return {
      kind: "toggle",
      selectedOptionIds: nextSelectedOptionIds,
    };
  }

  if (input.type !== "multi_done") {
    return invalid(`Expected multi-select input, received ${input.type}`);
  }

  const minSelected =
    question.minSelected ?? (question.required === false ? 0 : 1);

  if (selectedOptionIds.length < minSelected) {
    return invalid(`Select at least ${minSelected} option(s)`);
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
    return invalid(`Expected photo input, received ${input.type}`);
  }

  const fileId = input.fileId.trim();

  if (fileId.length === 0) {
    return invalid("Photo file id is required");
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
    return invalid(`Expected lab panel input, received ${input.type}`);
  }

  const answer: Record<string, number | null> = {};

  for (const field of question.fields) {
    const rawValue = input.values[field.id];

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.required === true) {
        return invalid(`${field.label} is required`);
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
      reason: `Expected numeric input, received ${input.type}`,
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
      reason: "Expected a finite number",
    };
  }

  const rawInput = value;
  const trimmed = rawInput.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      rawInput,
      reason: "Expected a number",
    };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      rawInput,
      reason: "Expected a number",
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
    return invalid("Expected an integer", String(value));
  }

  if (question.min !== undefined && value < question.min) {
    return invalid(`Number must be at least ${question.min}`, String(value));
  }

  if (question.max !== undefined && value > question.max) {
    return invalid(`Number must be at most ${question.max}`, String(value));
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
