import type { ChatId, DomainEvent, UserId } from "./events.js";

export type StoredDomainEvent = DomainEvent & {
  readonly sequence: number;
  readonly userSequence: number;
};

export interface EventStore {
  append(
    events: DomainEvent | readonly DomainEvent[],
  ): Promise<StoredDomainEvent[]>;
  loadAll(): Promise<StoredDomainEvent[]>;
  loadByChat(chatId: ChatId): Promise<StoredDomainEvent[]>;
  loadByUser(userId: UserId): Promise<StoredDomainEvent[]>;
}
