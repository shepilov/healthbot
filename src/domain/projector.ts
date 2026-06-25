import type { UserId } from "./events.js";
import type { EventStore, StoredDomainEvent } from "./event-store.js";

export interface Projector<TState> {
  initialState(): TState;
  apply(state: TState, event: StoredDomainEvent): TState;
}

export function replayEvents<TState>(
  events: readonly StoredDomainEvent[],
  projector: Projector<TState>,
): TState {
  return events.reduce(
    (state, event) => projector.apply(state, event),
    projector.initialState(),
  );
}

export async function replayUserEvents<TState>(
  eventStore: Pick<EventStore, "loadByUser">,
  userId: UserId,
  projector: Projector<TState>,
): Promise<TState> {
  const events = await eventStore.loadByUser(userId);

  return replayEvents(events, projector);
}
