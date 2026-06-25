import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../domain/index.js";
import { InMemoryActiveFlowStore, QuestionnaireEngine } from "./index.js";
import {
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
      "country",
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

function createProfileEngine() {
  const eventStore = new InMemoryEventStore();
  const engine = new QuestionnaireEngine({
    activeFlowStore: new InMemoryActiveFlowStore(),
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
  await engine.answer({
    userId: "user-1",
    input: { type: "number", value: 65 },
  });

  return engine.answer({
    userId: "user-1",
    input: { type: "text", value: "France" },
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
