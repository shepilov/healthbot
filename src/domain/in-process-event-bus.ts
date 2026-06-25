import type {
  AnyDomainEventHandler,
  DomainEventHandler,
  EventBus,
  Unsubscribe,
} from "./event-bus.js";
import type { DomainEvent, DomainEventType } from "./events.js";

export class InProcessEventBus implements EventBus {
  private readonly allHandlers = new Set<AnyDomainEventHandler>();
  private readonly handlersByType = new Map<
    DomainEventType,
    Set<DomainEventHandler>
  >();

  async publish(events: DomainEvent | readonly DomainEvent[]): Promise<void> {
    const incomingEvents = Array.isArray(events) ? events : [events];

    for (const event of incomingEvents) {
      await this.publishOne(event);
    }
  }

  subscribe<TType extends DomainEventType>(
    type: TType,
    handler: DomainEventHandler<TType>,
  ): Unsubscribe {
    const handlers = this.getHandlers(type);
    handlers.add(handler as DomainEventHandler);

    return () => {
      handlers.delete(handler as DomainEventHandler);
    };
  }

  subscribeAll(handler: AnyDomainEventHandler): Unsubscribe {
    this.allHandlers.add(handler);

    return () => {
      this.allHandlers.delete(handler);
    };
  }

  private async publishOne(event: DomainEvent): Promise<void> {
    const handlers = this.handlersByType.get(event.type) ?? new Set();

    for (const handler of handlers) {
      await handler(event);
    }

    for (const handler of this.allHandlers) {
      await handler(event);
    }
  }

  private getHandlers(type: DomainEventType): Set<DomainEventHandler> {
    const handlers = this.handlersByType.get(type);

    if (handlers !== undefined) {
      return handlers;
    }

    const nextHandlers = new Set<DomainEventHandler>();
    this.handlersByType.set(type, nextHandlers);

    return nextHandlers;
  }
}
