import { describe, expect, it } from "vitest";

import { createDomainEvent } from "./events.js";
import { InMemoryEventStore } from "./in-memory-event-store.js";

describe("InMemoryEventStore", () => {
  it("appends events with global and per-user sequence numbers", async () => {
    const store = new InMemoryEventStore();
    const first = createDomainEvent({
      type: "QuestionnaireStarted",
      userId: "user-1",
      chatId: "chat-1",
      payload: {
        questionnaireId: "profile",
      },
    });
    const second = createDomainEvent({
      type: "AnswerRecorded",
      userId: "user-1",
      chatId: "chat-1",
      payload: {
        questionnaireId: "profile",
        questionId: "age",
        answer: 35,
      },
    });
    const third = createDomainEvent({
      type: "UserSeen",
      userId: "user-2",
      chatId: "chat-2",
      payload: {
        telegramUserId: 222,
        chatId: 333,
      },
    });

    await store.append([first, second, third]);

    await expect(store.loadByUser("user-1")).resolves.toMatchObject([
      { id: first.id, sequence: 1, userSequence: 1 },
      { id: second.id, sequence: 2, userSequence: 2 },
    ]);
    await expect(store.loadByUser("user-2")).resolves.toMatchObject([
      { id: third.id, sequence: 3, userSequence: 1 },
    ]);
  });

  it("loads events by chat identity", async () => {
    const store = new InMemoryEventStore();
    const event = createDomainEvent({
      type: "QuestionnaireCancelled",
      userId: "user-1",
      chatId: "chat-1",
      payload: {
        questionnaireId: "profile",
        reason: "user_requested",
      },
    });

    await store.append(event);

    await expect(store.loadByChat("chat-1")).resolves.toMatchObject([
      { id: event.id, type: "QuestionnaireCancelled" },
    ]);
  });

  it("returns defensive array copies", async () => {
    const store = new InMemoryEventStore();
    const event = createDomainEvent({
      type: "QuestionnaireCompleted",
      userId: "user-1",
      payload: {
        questionnaireId: "profile",
      },
    });

    await store.append(event);
    const loaded = await store.loadByUser("user-1");
    loaded.length = 0;

    await expect(store.loadByUser("user-1")).resolves.toHaveLength(1);
  });
});
