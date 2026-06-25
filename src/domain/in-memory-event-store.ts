import type { ChatId, DomainEvent, UserId } from "./events.js";
import type { EventStore, StoredDomainEvent } from "./event-store.js";

export class InMemoryEventStore implements EventStore {
  private readonly events: StoredDomainEvent[] = [];
  private readonly eventsByChat = new Map<ChatId, StoredDomainEvent[]>();
  private readonly eventsByUser = new Map<UserId, StoredDomainEvent[]>();
  private nextSequence = 1;

  async append(
    events: DomainEvent | readonly DomainEvent[],
  ): Promise<StoredDomainEvent[]> {
    const incomingEvents = Array.isArray(events) ? events : [events];
    const storedEvents = incomingEvents.map((event) => this.store(event));

    return storedEvents;
  }

  async loadAll(): Promise<StoredDomainEvent[]> {
    return [...this.events];
  }

  async loadByChat(chatId: ChatId): Promise<StoredDomainEvent[]> {
    return [...(this.eventsByChat.get(chatId) ?? [])];
  }

  async loadByUser(userId: UserId): Promise<StoredDomainEvent[]> {
    return [...(this.eventsByUser.get(userId) ?? [])];
  }

  private store(event: DomainEvent): StoredDomainEvent {
    const userEvents = this.getUserEvents(event.userId);
    const storedEvent: StoredDomainEvent = {
      ...event,
      sequence: this.nextSequence,
      userSequence: userEvents.length + 1,
    };

    this.nextSequence += 1;
    this.events.push(storedEvent);
    userEvents.push(storedEvent);

    if (event.chatId !== undefined) {
      this.getChatEvents(event.chatId).push(storedEvent);
    }

    return storedEvent;
  }

  private getChatEvents(chatId: ChatId): StoredDomainEvent[] {
    const chatEvents = this.eventsByChat.get(chatId);

    if (chatEvents !== undefined) {
      return chatEvents;
    }

    const nextChatEvents: StoredDomainEvent[] = [];
    this.eventsByChat.set(chatId, nextChatEvents);

    return nextChatEvents;
  }

  private getUserEvents(userId: UserId): StoredDomainEvent[] {
    const userEvents = this.eventsByUser.get(userId);

    if (userEvents !== undefined) {
      return userEvents;
    }

    const nextUserEvents: StoredDomainEvent[] = [];
    this.eventsByUser.set(userId, nextUserEvents);

    return nextUserEvents;
  }
}
