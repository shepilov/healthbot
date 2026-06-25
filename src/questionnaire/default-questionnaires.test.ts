import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../domain/index.js";
import { InMemoryActiveFlowStore, QuestionnaireEngine } from "./index.js";
import {
  DAILY_QUESTIONNAIRE_ID,
  defaultQuestionnaires,
  MONTHLY_QUESTIONNAIRE_ID,
  PROFILE_QUESTIONNAIRE_ID,
  WEEKLY_QUESTIONNAIRE_ID,
} from "./default-questionnaires.js";

describe("default profile questionnaire", () => {
  it("contains the full one-time profile intake sequence", () => {
    const profile = getProfileQuestionnaire();

    expect(profile.questions.map((question) => question.id)).toEqual([
      "age",
      "height",
      "weight",
      "main_goal",
      "menstrual_status",
      "cycle_length",
      "pms_symptoms",
      "skin_type",
      "skin_concerns",
      "regular_skincare",
      "chronic_conditions",
      "medications",
    ]);
  });

  it("shows cycle length and PMS questions for cycle statuses", async () => {
    const { engine } = createProfileEngine();

    await answerProfileBasics(engine);
    await engine.answer({
      userId: "user-1",
      input: {
        type: "multi_toggle",
        optionId: "skin",
      },
    });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "multi_done",
      },
    });

    const menstrualStatus = await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "regular_cycle",
      },
    });

    expect(menstrualStatus).toMatchObject({
      status: "answered",
      question: { id: "cycle_length" },
    });

    const cycleLength = await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "26_30",
      },
    });

    expect(cycleLength).toMatchObject({
      status: "answered",
      question: { id: "pms_symptoms" },
    });
  });

  it("skips cycle length and PMS questions when cycle is not applicable", async () => {
    const { engine } = createProfileEngine();

    await answerProfileBasics(engine);
    await engine.answer({
      userId: "user-1",
      input: {
        type: "multi_toggle",
        optionId: "skin",
      },
    });
    await engine.answer({
      userId: "user-1",
      input: {
        type: "multi_done",
      },
    });

    const result = await engine.answer({
      userId: "user-1",
      input: {
        type: "single",
        optionId: "menopause",
      },
    });

    expect(result).toMatchObject({
      status: "answered",
      question: { id: "skin_type" },
    });
  });

  it("completes the full profile flow end-to-end", async () => {
    const { engine, eventStore } = createProfileEngine();

    await answerProfileBasics(engine);
    await answerMulti(engine, "skin");
    await answerSingle(engine, "regular_cycle");
    await answerSingle(engine, "26_30");
    await answerMulti(engine, "none");
    await answerSingle(engine, "normal");
    await answerMulti(engine, "dryness");
    await answerMulti(engine, "spf");
    await answerMulti(engine, "none");
    const result = await answerMulti(engine, "none");

    expect(result).toMatchObject({
      status: "completed",
      events: expect.arrayContaining([
        expect.objectContaining({ type: "QuestionnaireCompleted" }),
      ]),
    });
    await expect(eventStore.loadByUser("user-1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "QuestionnaireCompleted",
          payload: {
            questionnaireId: PROFILE_QUESTIONNAIRE_ID,
          },
        }),
      ]),
    );
  });
});

describe("default daily questionnaire", () => {
  it("contains the full daily check-in sequence", () => {
    const daily = getDailyQuestionnaire();

    expect(daily.period).toBe("daily");
    expect(daily.questions.map((question) => question.id)).toEqual([
      "mood",
      "energy",
      "stress",
      "sleep_duration",
      "skin_today",
      "self_like",
      "feel_beautiful",
      "sport_duration",
      "skincare_today",
      "cycle_today",
      "daily_influence",
    ]);
  });

  it("completes the daily flow and emits a daily period completion event", async () => {
    const { engine, eventStore } = createDefaultQuestionnaireEngine({
      clock: () => new Date(2026, 5, 25, 12, 0, 0),
    });

    await engine.start({
      questionnaireId: DAILY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });
    await answerScale(engine, 7);
    await answerScale(engine, 6);
    await answerScale(engine, 4);
    await answerSingle(engine, "7_8");
    await answerMulti(engine, "normal");
    await answerScale(engine, 8);
    await answerScale(engine, 7);
    await answerSingle(engine, "under_30");
    await answerMulti(engine, "spf");
    await answerMulti(engine, "unknown");
    const result = await answerSingle(engine, "sleep");

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          payload: {
            answer: "sleep",
            questionId: "daily_influence",
            questionnaireId: DAILY_QUESTIONNAIRE_ID,
          },
          type: "AnswerRecorded",
        },
        {
          payload: {
            questionnaireId: DAILY_QUESTIONNAIRE_ID,
          },
          type: "QuestionnaireCompleted",
        },
        {
          payload: {
            period: "daily",
            periodKey: "2026-06-25",
            questionnaireId: DAILY_QUESTIONNAIRE_ID,
          },
          type: "PeriodCheckInCompleted",
        },
      ],
    });

    const events = await eventStore.loadByUser("user-1");
    expect(
      events
        .filter((event) => event.type === "AnswerRecorded")
        .map((event) => event.payload.questionId),
    ).toEqual([
      "mood",
      "energy",
      "stress",
      "sleep_duration",
      "skin_today",
      "self_like",
      "feel_beautiful",
      "sport_duration",
      "skincare_today",
      "cycle_today",
      "daily_influence",
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: {
            period: "daily",
            periodKey: "2026-06-25",
            questionnaireId: DAILY_QUESTIONNAIRE_ID,
          },
          type: "PeriodCheckInCompleted",
        }),
      ]),
    );
  });
});

describe("default weekly questionnaire", () => {
  it("contains the full weekly check-in sequence", () => {
    const weekly = getWeeklyQuestionnaire();

    expect(weekly.period).toBe("weekly");
    expect(weekly.questions.map((question) => question.id)).toEqual([
      "weight",
      "bloating",
      "libido",
      "appearance_satisfaction",
      "life_satisfaction",
      "face_photo",
    ]);
  });

  it("rejects invalid numeric, scale, and photo answers", async () => {
    const { engine } = createDefaultQuestionnaireEngine();

    await engine.start({
      questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });

    await expect(
      engine.answer({
        userId: "user-1",
        input: {
          type: "text",
          value: "abc",
        },
      }),
    ).resolves.toMatchObject({
      question: { id: "weight" },
      status: "rejected",
    });

    await answerNumber(engine, 65);

    await expect(answerScale(engine, 11)).resolves.toMatchObject({
      question: { id: "bloating" },
      status: "rejected",
    });

    await answerScale(engine, 6);
    await answerScale(engine, 7);
    await answerScale(engine, 8);
    await answerScale(engine, 9);

    await expect(
      engine.answer({
        userId: "user-1",
        input: {
          type: "text",
          value: "not a photo",
        },
      }),
    ).resolves.toMatchObject({
      question: { id: "face_photo" },
      status: "rejected",
      validationError: "Загрузите фото или отмените анкету командой /cancel",
    });
  });

  it("completes the weekly flow and emits a weekly period completion event", async () => {
    const { engine, eventStore } = createDefaultQuestionnaireEngine({
      clock: () => new Date(2026, 0, 1, 12, 0, 0),
    });

    await engine.start({
      questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });
    await answerNumber(engine, 65);
    await answerScale(engine, 6);
    await answerScale(engine, 7);
    await answerScale(engine, 8);
    await answerScale(engine, 9);
    const result = await answerPhoto(engine, "telegram-file-id");

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          payload: {
            fileId: "telegram-file-id",
            questionId: "face_photo",
            questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
          },
          type: "PhotoReceived",
        },
        {
          payload: {
            answer: {
              fileId: "telegram-file-id",
            },
            questionId: "face_photo",
            questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
          },
          type: "AnswerRecorded",
        },
        {
          payload: {
            questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
          },
          type: "QuestionnaireCompleted",
        },
        {
          payload: {
            period: "weekly",
            periodKey: "2026-W01",
            questionnaireId: WEEKLY_QUESTIONNAIRE_ID,
          },
          type: "PeriodCheckInCompleted",
        },
      ],
    });

    const events = await eventStore.loadByUser("user-1");
    expect(
      events
        .filter((event) => event.type === "AnswerRecorded")
        .map((event) => event.payload.questionId),
    ).toEqual([
      "weight",
      "bloating",
      "libido",
      "appearance_satisfaction",
      "life_satisfaction",
      "face_photo",
    ]);
  });
});

describe("default monthly questionnaire", () => {
  it("contains the full monthly lab panel", () => {
    const monthly = getMonthlyQuestionnaire();
    const [question] = monthly.questions;

    if (question?.type !== "lab_panel") {
      throw new Error("Monthly questionnaire must contain a lab panel");
    }

    expect(monthly.period).toBe("monthly");
    expect(question.id).toBe("monthly_labs");
    expect(question.fields.map((field) => field.id)).toEqual([
      "ferritin",
      "vitamin_d",
      "tsh",
      "t4",
      "glucose",
      "insulin",
      "hba1c",
      "ldl",
      "hdl",
      "triglycerides",
    ]);
  });

  it("completes the monthly flow with all lab values and emits a monthly period event", async () => {
    const { engine } = createDefaultQuestionnaireEngine({
      clock: () => new Date(2026, 5, 25, 12, 0, 0),
    });

    await engine.start({
      questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });
    const result = await answerLabPanel(engine, {
      ferritin: "42.5",
      glucose: "5.1",
      hba1c: "5.4",
      hdl: "1.6",
      insulin: "8",
      ldl: "2.8",
      t4: "14",
      triglycerides: "0.9",
      tsh: "2.1",
      vitamin_d: "35",
    });

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          payload: {
            answer: {
              ferritin: 42.5,
              glucose: 5.1,
              hba1c: 5.4,
              hdl: 1.6,
              insulin: 8,
              ldl: 2.8,
              t4: 14,
              triglycerides: 0.9,
              tsh: 2.1,
              vitamin_d: 35,
            },
            questionId: "monthly_labs",
            questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
          },
          type: "AnswerRecorded",
        },
        {
          payload: {
            questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
          },
          type: "QuestionnaireCompleted",
        },
        {
          payload: {
            period: "monthly",
            periodKey: "2026-06",
            questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
          },
          type: "PeriodCheckInCompleted",
        },
      ],
    });
  });

  it("records skipped monthly lab values explicitly", async () => {
    const { engine } = createDefaultQuestionnaireEngine();

    await engine.start({
      questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });
    const result = await answerLabPanel(engine, {
      ferritin: "42.5",
      vitamin_d: null,
    });

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          payload: {
            answer: {
              ferritin: 42.5,
              glucose: null,
              hba1c: null,
              hdl: null,
              insulin: null,
              ldl: null,
              t4: null,
              triglycerides: null,
              tsh: null,
              vitamin_d: null,
            },
          },
          type: "AnswerRecorded",
        },
        { type: "QuestionnaireCompleted" },
        { type: "PeriodCheckInCompleted" },
      ],
    });
  });

  it("can complete the monthly flow with no lab values", async () => {
    const { engine } = createDefaultQuestionnaireEngine();

    await engine.start({
      questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });
    const result = await answerLabPanel(engine, {});

    expect(result).toMatchObject({
      status: "completed",
      events: [
        {
          payload: {
            answer: {
              ferritin: null,
              glucose: null,
              hba1c: null,
              hdl: null,
              insulin: null,
              ldl: null,
              t4: null,
              triglycerides: null,
              tsh: null,
              vitamin_d: null,
            },
          },
          type: "AnswerRecorded",
        },
        { type: "QuestionnaireCompleted" },
        { type: "PeriodCheckInCompleted" },
      ],
    });
  });

  it("rejects invalid monthly lab values and keeps the lab panel active", async () => {
    const { engine } = createDefaultQuestionnaireEngine();

    await engine.start({
      questionnaireId: MONTHLY_QUESTIONNAIRE_ID,
      userId: "user-1",
    });

    await expect(
      answerLabPanel(engine, {
        ferritin: "abc",
      }),
    ).resolves.toMatchObject({
      question: { id: "monthly_labs" },
      status: "rejected",
      validationError: "Ферритин: Expected a number",
    });
  });
});

function createProfileEngine() {
  return createDefaultQuestionnaireEngine();
}

function createDefaultQuestionnaireEngine({
  clock,
}: {
  readonly clock?: () => Date;
} = {}) {
  const eventStore = new InMemoryEventStore();
  const engine = new QuestionnaireEngine({
    activeFlowStore: new InMemoryActiveFlowStore(),
    ...(clock === undefined ? {} : { clock }),
    eventStore,
    questionnaires: defaultQuestionnaires,
  });

  return {
    engine,
    eventStore,
  };
}

async function answerProfileBasics(engine: QuestionnaireEngine) {
  await engine.start({
    questionnaireId: PROFILE_QUESTIONNAIRE_ID,
    userId: "user-1",
  });
  await engine.answer({
    userId: "user-1",
    input: { type: "number", value: 35 },
  });
  await engine.answer({
    userId: "user-1",
    input: { type: "number", value: 170 },
  });
  return engine.answer({
    userId: "user-1",
    input: { type: "number", value: 65 },
  });
}

async function answerSingle(engine: QuestionnaireEngine, optionId: string) {
  return engine.answer({
    userId: "user-1",
    input: {
      type: "single",
      optionId,
    },
  });
}

async function answerScale(engine: QuestionnaireEngine, value: number) {
  return engine.answer({
    userId: "user-1",
    input: {
      type: "scale_1_10",
      value,
    },
  });
}

async function answerNumber(engine: QuestionnaireEngine, value: number) {
  return engine.answer({
    userId: "user-1",
    input: {
      type: "number",
      value,
    },
  });
}

async function answerPhoto(engine: QuestionnaireEngine, fileId: string) {
  return engine.answer({
    userId: "user-1",
    input: {
      fileId,
      type: "photo",
    },
  });
}

async function answerLabPanel(
  engine: QuestionnaireEngine,
  values: Record<string, number | string | null | undefined>,
) {
  return engine.answer({
    userId: "user-1",
    input: {
      type: "lab_panel",
      values,
    },
  });
}

async function answerMulti(engine: QuestionnaireEngine, optionId: string) {
  await engine.answer({
    userId: "user-1",
    input: {
      type: "multi_toggle",
      optionId,
    },
  });

  return engine.answer({
    userId: "user-1",
    input: {
      type: "multi_done",
    },
  });
}

function getProfileQuestionnaire() {
  const profile = defaultQuestionnaires.find(
    (questionnaire) => questionnaire.id === PROFILE_QUESTIONNAIRE_ID,
  );

  if (profile === undefined) {
    throw new Error("Profile questionnaire is missing");
  }

  return profile;
}

function getDailyQuestionnaire() {
  const daily = defaultQuestionnaires.find(
    (questionnaire) => questionnaire.id === DAILY_QUESTIONNAIRE_ID,
  );

  if (daily === undefined) {
    throw new Error("Daily questionnaire is missing");
  }

  return daily;
}

function getWeeklyQuestionnaire() {
  const weekly = defaultQuestionnaires.find(
    (questionnaire) => questionnaire.id === WEEKLY_QUESTIONNAIRE_ID,
  );

  if (weekly === undefined) {
    throw new Error("Weekly questionnaire is missing");
  }

  return weekly;
}

function getMonthlyQuestionnaire() {
  const monthly = defaultQuestionnaires.find(
    (questionnaire) => questionnaire.id === MONTHLY_QUESTIONNAIRE_ID,
  );

  if (monthly === undefined) {
    throw new Error("Monthly questionnaire is missing");
  }

  return monthly;
}
