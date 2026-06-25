import { describe, expect, it } from "vitest";

import { createDomainEvent } from "./events.js";

describe("createDomainEvent", () => {
  it("creates typed domain events with defaults", () => {
    const event = createDomainEvent({
      type: "AnswerRejected",
      userId: "user-1",
      payload: {
        questionnaireId: "profile",
        questionId: "age",
        reason: "Expected a number",
        rawInput: "abc",
      },
    });

    expect(event).toMatchObject({
      type: "AnswerRejected",
      userId: "user-1",
      payload: {
        questionnaireId: "profile",
        questionId: "age",
        reason: "Expected a number",
        rawInput: "abc",
      },
    });
    expect(event.id).toHaveLength(36);
    expect(event.occurredAt).toBeInstanceOf(Date);
  });
});
