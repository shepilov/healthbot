import { describe, expect, it } from "vitest";

import { createDomainEvent } from "./events.js";
import { InMemoryEventStore } from "./in-memory-event-store.js";
import { replayUserEvents } from "./projector.js";
import type { Projector } from "./projector.js";

interface ProfileProgress {
  readonly answers: number;
  readonly completed: boolean;
}

const profileProgressProjector: Projector<ProfileProgress> = {
  initialState() {
    return {
      answers: 0,
      completed: false,
    };
  },
  apply(state, event) {
    if (event.type === "AnswerRecorded") {
      return {
        ...state,
        answers: state.answers + 1,
      };
    }

    if (event.type === "QuestionnaireCompleted") {
      return {
        ...state,
        completed: true,
      };
    }

    return state;
  },
};

describe("replayUserEvents", () => {
  it("replays one user's events through a projector", async () => {
    const store = new InMemoryEventStore();

    await store.append([
      createDomainEvent({
        type: "AnswerRecorded",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
          questionId: "age",
          answer: 35,
        },
      }),
      createDomainEvent({
        type: "QuestionnaireCompleted",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
        },
      }),
      createDomainEvent({
        type: "AnswerRecorded",
        userId: "user-2",
        payload: {
          questionnaireId: "profile",
          questionId: "age",
          answer: 40,
        },
      }),
    ]);

    await expect(
      replayUserEvents(store, "user-1", profileProgressProjector),
    ).resolves.toEqual({
      answers: 1,
      completed: true,
    });
  });
});
