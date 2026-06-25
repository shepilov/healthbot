import { describe, expect, it } from "vitest";

import { createDomainEvent } from "../domain/index.js";
import { getQuestionnaireStatus } from "./questionnaire-status.js";

describe("getQuestionnaireStatus", () => {
  it("treats the latest questionnaire lifecycle event as current state", () => {
    expect(
      getQuestionnaireStatus(
        [
          createDomainEvent({
            type: "QuestionnaireCompleted",
            userId: "user-1",
            payload: {
              questionnaireId: "profile",
            },
          }),
          createDomainEvent({
            type: "QuestionnaireStarted",
            userId: "user-1",
            payload: {
              questionnaireId: "profile",
            },
          }),
        ],
        "profile",
      ),
    ).toEqual({
      completed: false,
      started: true,
    });
  });

  it("ignores other questionnaires", () => {
    expect(
      getQuestionnaireStatus(
        [
          createDomainEvent({
            type: "QuestionnaireCompleted",
            userId: "user-1",
            payload: {
              questionnaireId: "daily",
            },
          }),
        ],
        "profile",
      ),
    ).toEqual({
      completed: false,
      started: false,
    });
  });
});
