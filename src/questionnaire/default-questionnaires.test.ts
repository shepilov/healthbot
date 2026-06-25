import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../domain/index.js";
import { InMemoryActiveFlowStore, QuestionnaireEngine } from "./index.js";
import {
  DAILY_QUESTIONNAIRE_ID,
  defaultQuestionnaires,
  PROFILE_QUESTIONNAIRE_ID,
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
