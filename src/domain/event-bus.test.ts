import { describe, expect, it } from "vitest";

import { createDomainEvent } from "./events.js";
import { InProcessEventBus } from "./in-process-event-bus.js";

describe("InProcessEventBus", () => {
  it("publishes events to type-specific and all-event handlers", async () => {
    const bus = new InProcessEventBus();
    const delivered: string[] = [];
    const event = createDomainEvent({
      type: "UserSeen",
      userId: "user-1",
      chatId: "chat-1",
      payload: {
        telegramUserId: 123,
        chatId: 456,
      },
    });

    bus.subscribe("UserSeen", async (publishedEvent) => {
      delivered.push(`specific:${publishedEvent.type}`);
    });
    bus.subscribeAll(async (publishedEvent) => {
      delivered.push(`all:${publishedEvent.type}`);
    });

    await bus.publish(event);

    expect(delivered).toEqual(["specific:UserSeen", "all:UserSeen"]);
  });

  it("removes handlers when unsubscribed", async () => {
    const bus = new InProcessEventBus();
    const delivered: string[] = [];
    const event = createDomainEvent({
      type: "QuestionnaireStarted",
      userId: "user-1",
      payload: {
        questionnaireId: "profile",
      },
    });

    const unsubscribe = bus.subscribe("QuestionnaireStarted", async () => {
      delivered.push("called");
    });

    unsubscribe();
    await bus.publish(event);

    expect(delivered).toEqual([]);
  });
});
