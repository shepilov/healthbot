import { describe, expect, it } from "vitest";

import { createDomainEvent, InMemoryEventStore } from "../domain/index.js";
import {
  getQuestionnaireStatus,
  projectUserStatus,
} from "./questionnaire-status.js";

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

describe("projectUserStatus", () => {
  it("keeps a completed profile completed while a later edit is cancelled", async () => {
    const store = new InMemoryEventStore();

    await store.append([
      createDomainEvent({
        type: "QuestionnaireStarted",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
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
        type: "QuestionnaireStarted",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
        },
      }),
      createDomainEvent({
        type: "QuestionnaireCancelled",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
        },
      }),
    ]);

    const status = projectUserStatus(await store.loadByUser("user-1"), {
      profileQuestionnaireId: "profile",
    });

    expect(status.profile).toEqual({
      completed: true,
      started: true,
    });
  });

  it("projects profile status and latest completed check-ins", async () => {
    const store = new InMemoryEventStore();

    await store.append([
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 10, 0, 0),
        type: "QuestionnaireCompleted",
        userId: "user-1",
        payload: {
          questionnaireId: "profile",
        },
      }),
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 11, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "user-1",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
      createDomainEvent({
        occurredAt: new Date(2026, 5, 25, 12, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "user-1",
        payload: {
          period: "monthly",
          periodKey: "2026-06",
          questionnaireId: "monthly",
        },
      }),
    ]);

    const status = projectUserStatus(await store.loadByUser("user-1"), {
      profileQuestionnaireId: "profile",
    });

    expect(status).toMatchObject({
      checkIns: {
        daily: {
          periodKey: "2026-06-25",
          questionnaireId: "daily",
          userSequence: 2,
        },
        monthly: {
          periodKey: "2026-06",
          questionnaireId: "monthly",
          userSequence: 3,
        },
        weekly: undefined,
      },
      profile: {
        completed: true,
        started: true,
      },
    });
  });

  it("replaces same-period read model state while preserving append-only events", async () => {
    const store = new InMemoryEventStore();

    await store.append([
      createDomainEvent({
        id: "daily-first",
        occurredAt: new Date(2026, 5, 25, 9, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "user-1",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
      createDomainEvent({
        id: "daily-second",
        occurredAt: new Date(2026, 5, 25, 18, 0, 0),
        type: "PeriodCheckInCompleted",
        userId: "user-1",
        payload: {
          period: "daily",
          periodKey: "2026-06-25",
          questionnaireId: "daily",
        },
      }),
    ]);

    const events = await store.loadByUser("user-1");
    const status = projectUserStatus(events, {
      profileQuestionnaireId: "profile",
    });

    expect(events).toHaveLength(2);
    expect(status.checkIns.daily).toMatchObject({
      eventId: "daily-second",
      periodKey: "2026-06-25",
      userSequence: 2,
    });
  });
});
