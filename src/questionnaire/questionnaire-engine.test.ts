import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../domain/index.js";
import { InMemoryActiveFlowStore } from "./active-flow-store.js";
import { QuestionnaireEngine } from "./questionnaire-engine.js";
import type { QuestionnaireDefinition } from "./types.js";

const sampleQuestionnaire: QuestionnaireDefinition = {
  id: "sample",
  questions: [
    {
      id: "cycle_status",
      type: "single",
      text: "Есть цикл?",
      options: [
        { id: "yes", label: "Да" },
        { id: "no", label: "Нет" },
      ],
    },
    {
      id: "cycle_length",
      type: "number",
      text: "Средняя длина цикла",
      min: 20,
      max: 45,
      integer: true,
      when: ({ getAnswer }) => getAnswer("cycle_status") === "yes",
    },
    {
      id: "notes",
      type: "text",
      text: "Комментарий",
      required: false,
    },
  ],
};

function createEngine(
  questionnaires: readonly QuestionnaireDefinition[] = [sampleQuestionnaire],
) {
  const activeFlowStore = new InMemoryActiveFlowStore();
  const eventStore = new InMemoryEventStore();
  const engine = new QuestionnaireEngine({
    activeFlowStore,
    eventStore,
    questionnaires,
  });

  return { activeFlowStore, engine, eventStore };
}

describe("QuestionnaireEngine", () => {
  it("starts a questionnaire and emits QuestionnaireStarted", async () => {
    const { activeFlowStore, engine, eventStore } = createEngine();

    const result = await engine.start({
      questionnaireId: "sample",
      userId: "user-1",
      chatId: "chat-1",
    });

    await expect(activeFlowStore.get("user-1")).resolves.toMatchObject({
      currentQuestionId: "cycle_status",
      questionnaireId: "sample",
      userId: "user-1",
    });
    await expect(eventStore.loadByUser("user-1")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
    ]);
    expect(result).toMatchObject({
      status: "started",
      question: { id: "cycle_status" },
      events: [{ type: "QuestionnaireStarted" }],
    });
  });

  it("starts an edit flow from existing answers", async () => {
    const { activeFlowStore, engine } = createEngine();

    const result = await engine.start({
      initialAnswers: {
        cycle_length: 29,
        cycle_status: "yes",
        notes: "old note",
      },
      questionnaireId: "sample",
      userId: "user-1",
    });

    expect(result).toMatchObject({
      progress: {
        current: 1,
        total: 3,
      },
      question: { id: "cycle_status" },
      status: "started",
    });
    await expect(activeFlowStore.get("user-1")).resolves.toMatchObject({
      answers: {
        cycle_length: 29,
        cycle_status: "yes",
        notes: "old note",
      },
      currentQuestionId: "cycle_status",
    });
  });

  it("drops existing answers that become hidden after an edit", async () => {
    const { activeFlowStore, engine } = createEngine();
    await engine.start({
      initialAnswers: {
        cycle_length: 29,
        cycle_status: "yes",
        notes: "old note",
      },
      questionnaireId: "sample",
      userId: "user-1",
    });

    const result = await engine.answer({
      input: {
        optionId: "no",
        type: "single",
      },
      userId: "user-1",
    });

    expect(result).toMatchObject({
      question: { id: "notes" },
      status: "answered",
    });
    await expect(activeFlowStore.get("user-1")).resolves.toMatchObject({
      answers: {
        cycle_status: "no",
        notes: "old note",
      },
      currentQuestionId: "notes",
    });
    await expect(activeFlowStore.get("user-1")).resolves.not.toMatchObject({
      answers: {
        cycle_length: expect.anything(),
      },
    });
  });

  it("returns the next visible question after a valid answer", async () => {
    const { engine } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "yes",
      },
    });

    expect(result).toMatchObject({
      status: "answered",
      question: { id: "cycle_length" },
      events: [{ type: "AnswerRecorded" }],
    });
  });

  it("skips conditional questions when they are not visible", async () => {
    const { engine } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "no",
      },
    });

    expect(result).toMatchObject({
      status: "answered",
      question: { id: "notes" },
    });
  });

  it("rejects invalid numeric answers and keeps the current question active", async () => {
    const { activeFlowStore, engine, eventStore } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "yes",
      },
    });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "text",
        value: "abc",
      },
    });

    await expect(activeFlowStore.get("user-1")).resolves.toMatchObject({
      currentQuestionId: "cycle_length",
    });
    await expect(eventStore.loadByUser("user-1")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      { type: "AnswerRecorded" },
      { type: "AnswerRejected" },
    ]);
    expect(result).toMatchObject({
      status: "rejected",
      question: { id: "cycle_length" },
      events: [{ type: "AnswerRejected" }],
    });
  });

  it("supports multi-select toggle and done behavior", async () => {
    const { activeFlowStore, engine, eventStore } = createEngine([
      {
        id: "multi",
        questions: [
          {
            id: "symptoms",
            type: "multi",
            text: "Симптомы",
            minSelected: 1,
            options: [
              { id: "stress", label: "Стресс" },
              { id: "sleep", label: "Сон" },
            ],
          },
        ],
      },
    ]);
    await engine.start({ questionnaireId: "multi", userId: "user-1" });

    await expect(
      engine.answer({
        userId: "user-1",
        input: {
          type: "multi_toggle",
          optionId: "stress",
        },
      }),
    ).resolves.toMatchObject({
      status: "multi_selection_changed",
      question: { id: "symptoms" },
      events: [],
    });
    await expect(
      engine.answer({
        userId: "user-1",
        input: {
          type: "multi_toggle",
          optionId: "sleep",
        },
      }),
    ).resolves.toMatchObject({
      status: "multi_selection_changed",
    });

    const done = await engine.answer({
      userId: "user-1",
      input: {
        type: "multi_done",
      },
    });

    await expect(activeFlowStore.get("user-1")).resolves.toBeUndefined();
    await expect(eventStore.loadByUser("user-1")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      {
        type: "AnswerRecorded",
        payload: {
          questionId: "symptoms",
          answer: ["stress", "sleep"],
        },
      },
      { type: "QuestionnaireCompleted" },
    ]);
    expect(done).toMatchObject({
      status: "completed",
      events: [{ type: "AnswerRecorded" }, { type: "QuestionnaireCompleted" }],
    });
  });

  it("moves back to the previous visible question and clears that answer", async () => {
    const { activeFlowStore, engine } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "yes",
      },
    });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "number",
        value: 28,
      },
    });

    const result = await engine.back({ userId: "user-1" });

    expect(result).toMatchObject({
      question: { id: "cycle_length" },
      status: "moved_back",
    });
    await expect(activeFlowStore.get("user-1")).resolves.toMatchObject({
      answers: {
        cycle_status: "yes",
      },
      currentQuestionId: "cycle_length",
    });
  });

  it("records skipped optional questions explicitly", async () => {
    const { eventStore, engine } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "no",
      },
    });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "skip",
      },
    });

    expect(result).toMatchObject({
      status: "completed",
    });
    await expect(eventStore.loadByUser("user-1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            answer: null,
            questionId: "notes",
          }),
          type: "AnswerRecorded",
        }),
      ]),
    );
  });

  it("emits photo-specific and answer events for photo questions", async () => {
    const { engine } = createEngine([
      {
        id: "photo",
        questions: [
          {
            id: "face_photo",
            type: "photo",
            text: "Фото лица",
          },
        ],
      },
    ]);
    await engine.start({ questionnaireId: "photo", userId: "user-1" });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "photo",
        fileId: "file-1",
        fileUniqueId: "unique-1",
      },
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "PhotoReceived",
      "AnswerRecorded",
      "QuestionnaireCompleted",
    ]);
  });

  it("validates lab panel answers", async () => {
    const { engine } = createEngine([
      {
        id: "labs",
        questions: [
          {
            id: "monthly_labs",
            type: "lab_panel",
            text: "Анализы",
            fields: [
              { id: "ferritin", label: "Ферритин", min: 0 },
              { id: "vitamin_d", label: "Витамин D", min: 0 },
            ],
          },
        ],
      },
    ]);
    await engine.start({ questionnaireId: "labs", userId: "user-1" });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "lab_panel",
        values: {
          ferritin: "42.5",
          vitamin_d: "",
        },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          type: "AnswerRecorded",
          payload: {
            answer: {
              ferritin: 42.5,
              vitamin_d: null,
            },
          },
        },
        { type: "QuestionnaireCompleted" },
      ],
    });
  });

  it("cancels an active questionnaire and clears active state", async () => {
    const { activeFlowStore, engine, eventStore } = createEngine();
    await engine.start({ questionnaireId: "sample", userId: "user-1" });

    const result = await engine.cancel({
      userId: "user-1",
      reason: "user_requested",
    });

    await expect(activeFlowStore.get("user-1")).resolves.toBeUndefined();
    await expect(eventStore.loadByUser("user-1")).resolves.toMatchObject([
      { type: "QuestionnaireStarted" },
      { type: "QuestionnaireCancelled" },
    ]);
    expect(result).toMatchObject({
      status: "cancelled",
      events: [{ type: "QuestionnaireCancelled" }],
    });
  });
});
