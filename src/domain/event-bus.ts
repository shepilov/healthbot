import type { DomainEvent, DomainEventType } from "./events.js";

export type Unsubscribe = () => void;

export type DomainEventHandler<
  TType extends DomainEventType = DomainEventType,
> = (event: DomainEvent<TType>) => void | Promise<void>;

export type AnyDomainEventHandler = (
  event: DomainEvent,
) => void | Promise<void>;

export interface EventBus {
  publish(events: DomainEvent | readonly DomainEvent[]): Promise<void>;
  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: DomainEventHandler<TType>,
  ): Unsubscribe;
  subscribeAll(handler: AnyDomainEventHandler): Unsubscribe;
}
